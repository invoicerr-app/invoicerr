/**
 * The B2G FR path, END TO END, at the SERVICE level — the one thing `invoice-b2g-routing.spec.ts`
 * (bare `{ send: jest.fn() }` stub transports) and `transports/chorus-pro-transport.spec.ts` (the
 * transport in isolation) each prove HALF of: a FRENCH government client, on a company whose
 * "chorus-pro" channel IS connected, actually reaches the REAL `buildChorusProTransport` through the
 * REAL `resolveInvoiceTransport`/`resolveB2gInvoiceTransport` precedence machinery — preflight passes,
 * and the async worker's replay (`deliver()`, phase 2 — see `async-send.ts`'s own header) genuinely
 * calls the (mocked) Chorus Pro client and persists the returned `numeroFluxDepot` as `transportRef`.
 *
 * `b2g-routing/b2g-routing.ts` is mocked wholesale, same convention `invoice-b2g-routing.spec.ts`
 * already established (this file's own job is NOT "is the FR rule's data right" — `b2g-routing/data/
 * all.spec.ts` owns that); `@/prisma/prisma.service` and `./chorus-pro/choruspro-client`'s
 * `ChorusProClient` are mocked wholesale too, the SAME two seams `chorus-pro-transport.spec.ts` mocks
 * — this file's own job is "does the WIRING between B2G routing and the real transport work", never a
 * live PISTE round-trip (that is `chorus-pro/choruspro-live.spec.ts`'s job, gated, skipped today).
 */
import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import * as persistence from '../persistence';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { DocumentFormatProvider } from '../formats/format-provider';
import { buildChorusProTransport } from '../transports/chorus-pro-transport';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';

jest.mock('../persistence');
jest.mock('../transports/company-transport');
jest.mock('../b2g-routing/b2g-routing');
jest.mock('../numbering/take-number');
jest.mock('../tax/load-and-resolve');

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockDeposerFlux = jest.fn();

jest.mock('../transports/chorus-pro/choruspro-client', () => {
  const actual = jest.requireActual('../transports/chorus-pro/choruspro-client');
  return {
    ...actual,
    ChorusProClient: jest.fn().mockImplementation(() => ({ deposerFlux: mockDeposerFlux })),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const FR_RULE = {
  countryCode: 'FR',
  transportId: 'chorus-pro',
  formatSyntax: 'facturx',
  requiredClientIdentifiers: [{ scheme: 'LEGAL_ID', label: 'SIRET', why: 'Chorus Pro identifies by SIRET.' }],
  requiredDocumentFields: [],
  provenanceDescription: '"Code de la commande publique, art. L. 2192-1..." (checked 2026-09-01)',
};

// A CONNECTED chorus-pro config — the "canal connecté (stub)" the task brief asks for: complete
// enough to pass `extractChorusProCredentials`, never a real PISTE credential.
const CONNECTED_CHORUS_PRO_CONFIG = {
  providerId: 'chorus-pro',
  channel: 'CHORUS-PRO',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    clientId: 'piste-id-stub',
    clientSecret: 'piste-secret-stub',
    technicalAccountLogin: 'TECH_1_stub@cpro.fr',
    technicalAccountPassword: 'tech-password-stub',
  },
};

const documentData = {
  client: 'client-1',
  issueDate: '2026-09-01',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
};

function draftDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data: documentData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sendingDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: documentData,
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'INV-2026-0001',
    ...overrides,
  };
}

function buildRegistry() {
  // The REAL chorus-pro transport, wired the SAME way `documents-core.module.ts#buildTransportRegistry`
  // wires it — never a bare `{ send: jest.fn() }` stub, unlike every OTHER transport in
  // `invoice-b2g-routing.spec.ts`'s own registry: this file's whole point is proving the wiring past
  // the transport's own boundary, not just the precedence logic in front of it.
  const channelCredentials = {
    resolveActive: jest.fn().mockResolvedValue(CONNECTED_CHORUS_PRO_CONFIG),
  } as unknown as ChannelCredentialsService;
  // A STUBBED format provider — never the real `buildFacturxFormatProvider` (which needs a live
  // Puppeteer render + real Company/Client DB rows well beyond this test's own concern, see
  // `formats/facturx-provider.spec.ts` for THAT gate's own coverage, and
  // `chorus-pro-transport.spec.ts`'s own "MUTATION GUARD #2" for the Factur-X gate proof at the
  // transport level). This file's OWN job is the WIRING from B2G routing through to the client, the
  // exact "mock/stub" the task brief itself asks for.
  const facturxFormatProvider: DocumentFormatProvider = {
    id: 'facturx',
    syntax: 'FACTURX',
    mime: 'application/pdf',
    build: jest
      .fn()
      .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), validation: { valid: true, errors: [] } }),
  };

  const transportRegistry = new TransportRegistry();
  transportRegistry.register(
    'chorus-pro',
    'Chorus Pro (France)',
    buildChorusProTransport({ channelCredentials, facturxFormatProvider }),
  );

  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: jest.fn() } });
  return registry;
}

describe('B2G FR, end to end at the service level — government client + connected chorus-pro channel', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
      applies: true,
      countryCode: 'FR',
      rule: FR_RULE,
      missingIdentifierSchemes: [],
    });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email'); // irrelevant — B2G overrides it
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );

    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    });
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Mairie de Testville',
      address: '1 Place de la Mairie',
      city: 'Testville',
      postalCode: '75001',
      country: 'France',
      partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '21750001600017' }],
    });
  });

  it('phase 1 (enqueue): the preflight PASSES — chorus-pro is registered AND connected, so B2G routing no longer refuses', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingDocument());
    const handler = buildRegistry().resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
    // Never reaches the network at phase 1 — only preflight() ran, never send().
    expect(mockDeposerFlux).not.toHaveBeenCalled();
  });

  it('phase 2 (the worker replay, deliver()): the job ACTUALLY calls the Chorus Pro client and persists its numeroFluxDepot as transportRef', async () => {
    mockDeposerFlux.mockResolvedValue({
      numeroFluxDepot: '375037',
      statut: 'DEPOSE',
      httpStatus: 200,
      raw: {},
    });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument());
    (persistence.updateDocumentStatus as jest.Mock).mockImplementation(
      (_companyId, _typeId, _documentId, status, _err, reference, providerId) =>
        Promise.resolve(sendingDocument({ status, transportRef: reference, channelProviderId: providerId })),
    );
    const handler = buildRegistry().resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    // THE PROOF this task's own brief asks for: the (mocked) client was genuinely invoked, with the
    // Factur-X bytes the format registry built (never skipped), and its numeroFluxDepot made it all
    // the way to `updateDocumentStatus`'s own `reference`/`providerId` write.
    expect(mockDeposerFlux).toHaveBeenCalledTimes(1);
    expect(mockDeposerFlux).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(String),
      'IN_DP_E3_FACTUR_X_10',
    );
    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      'sent',
      null,
      '375037',
      'chorus-pro',
    );
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sent', transportRef: '375037' });
  });
});
