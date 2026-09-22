/**
 * The B2G FR path, END TO END, at the SERVICE level — the one thing `invoice-b2g-routing.spec.ts`
 * (bare `{ send: vi.fn() }` stub transports) and `transports/chorus-pro-transport.spec.ts` (the
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
 * live PISTE round-trip (that is `chorus-pro/choruspro.live.spec.ts`'s job — proven live in
 * qualification 2026-09-14, see that file's own header).
 */
import { vi, type Mock } from 'vitest';

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

vi.mock('../persistence');
vi.mock('../transports/company-transport');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../numbering/take-number');
vi.mock('../tax/load-and-resolve');

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
    // Read by THE PAYMENT MEANS GATE's own `listCompanyPaymentMethods` (real, unmocked here —
    // deliberately: see this file's own header, "does the WIRING... work", never a stubbed persistence
    // module) — `chorus-pro-transport.ts` refuses a deposit unless "bank_transfer" comes back enabled.
    companyPaymentMethodConfig: { findUnique: vi.fn() },
  },
}));

// `mockDeposerFlux` — referenced INSIDE the `vi.mock(...)` factory below, but declared here in plain
// module scope: `vi.mock()` calls are hoisted above every import (and above this declaration too),
// so this only works because Vitest keeps Jest's own naming-convention exception — a factory MAY
// reference an out-of-scope variable whose name starts with "mock" (case-insensitive); anything else
// throws a hoisting `ReferenceError`. Confirmed under Vitest during this migration: `mockDeposerFlux`
// resolves correctly, and renaming it to break the convention (`depositMock`) reproduces exactly that
// ReferenceError. Prefer `vi.hoisted()` for a NEW file instead of relying on this convention — see the
// migration recipe's own hoisting entry — but this rename is out of scope for a mechanical port.
const mockDeposerFlux = vi.fn();

vi.mock('../transports/chorus-pro/choruspro-client', async () => {
  const actual = await vi.importActual('../transports/chorus-pro/choruspro-client');
  return {
    ...actual,
    // A `function` expression, NOT the original arrow function — production code does
    // `new ChorusProClient(...)` (chorus-pro-transport.ts's own `buildClient`). Jest's mock functions
    // never really invoke the implementation via `[[Construct]]` (they call it plainly and use its
    // return value regardless), so an arrow-function implementation worked there; Vitest's mocks DO
    // construct the real implementation, and an arrow function has no `[[Construct]]` at all —
    // "TypeError: ... is not a constructor". Confirmed by hitting exactly that error during this
    // migration before switching to `function`.
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new ChorusProClient(...)` under Vitest, see above.
    ChorusProClient: vi.fn().mockImplementation(function () {
      return { deposerFlux: mockDeposerFlux };
    }),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  client: { findFirst: Mock };
  companyPaymentMethodConfig: { findUnique: Mock };
};

const FR_RULE = {
  countryCode: 'FR',
  transportId: 'chorus-pro',
  formatSyntax: 'facturx',
  requiredClientIdentifiers: [{ scheme: 'LEGAL_ID', label: 'SIRET', why: 'Chorus Pro identifies by SIRET.' }],
  requiredDocumentFields: [],
  provenanceDescription: '"Code de la commande publique, art. L. 2192-1..." (checked 2026-09-01)',
};

// A CONNECTED chorus-pro config — the "connected channel (stub)" the task brief asks for: complete
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
  // wires it — never a bare `{ send: vi.fn() }` stub, unlike every OTHER transport in
  // `invoice-b2g-routing.spec.ts`'s own registry: this file's whole point is proving the wiring past
  // the transport's own boundary, not just the precedence logic in front of it.
  const channelCredentials = {
    resolveActive: vi.fn().mockResolvedValue(CONNECTED_CHORUS_PRO_CONFIG),
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
    build: vi
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
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return registry;
}

describe('B2G FR, end to end at the service level — government client + connected chorus-pro channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
      applies: true,
      countryCode: 'FR',
      rule: FR_RULE,
      missingIdentifierSchemes: [],
    });
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('email'); // irrelevant — B2G overrides it
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
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
      // Required by THE PAYMENT MEANS GATE (`chorus-pro-transport.ts`): a public-sector deposit is
      // refused without an IBAN on file, independent of the "bank_transfer" method's own enabled flag
      // below — see that gate's own header on why the two checks are not redundant.
      iban: 'FR7630006000011234567890189',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    });
    mockedPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Mairie de Testville',
      address: '1 Place de la Mairie',
      city: 'Testville',
      postalCode: '75001',
      country: 'France',
      partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '21750001600017' }],
    });
    // THE PAYMENT MEANS GATE reads this company's own CONFIGURED payment methods via the REAL
    // `listCompanyPaymentMethods` (deliberately unmocked — see this file's own header): only
    // "bank_transfer" comes back enabled here, the ONE method Chorus Pro's own strict allowlist
    // accepts (`CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID`) — every other built-in method stays unconfigured
    // (`enabled: false`), which the gate already accepts as "not offered", never a refusal on its own.
    mockedPrisma.companyPaymentMethodConfig.findUnique.mockImplementation(
      ({ where }: { where: { companyId_methodId: { methodId: string } } }) =>
        Promise.resolve(
          where.companyId_methodId.methodId === 'bank_transfer' ? { enabled: true, config: {} } : null,
        ),
    );
  });

  it('phase 1 (enqueue): the preflight PASSES — chorus-pro is registered AND connected, so B2G routing no longer refuses', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as Mock).mockResolvedValue(sendingDocument());
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
    (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingDocument());
    (persistence.updateDocumentStatus as Mock).mockImplementation(
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

    // THE PROOF: the (mocked) client was genuinely invoked, with the
    // Factur-X bytes the format registry built (never skipped), and its numeroFluxDepot made it all
    // the way to `updateDocumentStatus`'s own `reference`/`providerId` write.
    expect(mockDeposerFlux).toHaveBeenCalledTimes(1);
    expect(mockDeposerFlux).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(String),
      // IN_DP_E2_CII_FACTURX, not IN_DP_E3_FACTUR_X_10 — see choruspro-client.ts's own header,
      // "CORRECTED 2026-09-14 (second correction, same day)": the old value was never a member of the
      // Swagger's own `DeposerFluxFactureParam.syntaxeFlux` enum.
      'IN_DP_E2_CII_FACTURX',
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
