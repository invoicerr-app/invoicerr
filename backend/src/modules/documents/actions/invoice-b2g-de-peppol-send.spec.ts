/**
 * The B2G DE path, END TO END, at the SERVICE level — "le trou allemand du B2G", closed. Same shape
 * as `invoice-b2g-chorus-pro-send.spec.ts` (which proves the FR/chorus-pro wiring): `b2g-routing/
 * b2g-routing.ts` is mocked wholesale (this file's own job is NOT "is the DE rule's own data right" —
 * `b2g-routing/data/all.spec.ts` owns that), `@/prisma/prisma.service` is mocked, and the REGISTRY
 * under test wires the REAL `buildPeppolTransport` — never a bare `{ send: jest.fn() }` stub — so this
 * proves the WIRING between B2G routing and the transport's own format override actually works, not
 * merely that each piece is individually correct in isolation.
 *
 * Unlike the chorus-pro sibling, the Access Point itself (`PeppolApHttpClient`) IS mocked here
 * (`jest.spyOn(...prototype, 'send')`) rather than exercised via a real local HTTP stub —
 * `peppol-transport.spec.ts` already proves the real wire format against a real local server; this
 * file's own job is the ONE thing that spec CANNOT prove (it calls `buildPeppolTransport` directly,
 * never through `resolveInvoiceTransport`/`resolveB2gInvoiceTransport`): that the `formatOverride`
 * ACTUALLY reaches the transport's `send()` call, all the way from `b2g-routing/data/de.json`'s own
 * `formatSyntax`, through the real preflight/deliver two-phase send.
 */
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import * as persistence from '../persistence';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { peppolBisFormatProvider } from '../formats/peppol-bis-provider';
import { xrechnungFormatProvider } from '../formats/xrechnung-provider';
import { PeppolApHttpClient, PEPPOL_DOC_TYPES } from '../transports/peppol/peppol-client';
import { buildPeppolTransport } from '../transports/peppol-transport';
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

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

// The REAL DE rule shape (`b2g-routing/data/de.json`) — `transportId: "peppol"`,
// `formatSyntax: "xrechnung"`. Mirrored here by hand (never imported from the JSON file directly),
// same convention `FR_RULE` already holds in the chorus-pro sibling — this file's own job is the
// WIRING, not re-proving the rule's own data (`b2g-routing/data/all.spec.ts` owns that).
const DE_RULE = {
  countryCode: 'DE',
  transportId: 'peppol',
  formatSyntax: 'xrechnung',
  requiredClientIdentifiers: [],
  requiredDocumentFields: [
    { field: 'buyerReference', label: 'Buyer reference (Leitweg-ID)', why: '§ 5 ERechV.', required: true },
  ],
  provenanceDescription: '"§ 4/§ 5 ERechV..." (checked 2026-09-01)',
};

// A CONNECTED peppol config — the "canal connecté (stub)" the task brief asks for: complete enough to
// pass `extractPeppolCredentials`, never a real Access Point.
const CONNECTED_PEPPOL_CONFIG = {
  providerId: 'peppol',
  channel: 'PEPPOL',
  environment: 'TEST' as const,
  isActive: true,
  config: { accessPointUrl: 'http://127.0.0.1:1', apiKey: 'ap-key-stub', participantId: '9930:DE123456789' },
};

/** ISO 13616's own published example IBAN (Deutsche Bundesbank) — checksum-valid, never a real
 *  account — the SAME fixture value `xrechnung-provider.spec.ts`'s own master proof already uses. */
const TEST_IBAN = 'DE89370400440532013000';

const COMPANY_WITH_IBAN = {
  id: 'company-1',
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  email: 'contact@muster.example',
  phone: '+49301234567',
  iban: TEST_IBAN,
  // "un certificat rien-à-voir" (task brief) — a signing certificate is FACe/Facturae's own concept
  // (root TODO item 13), entirely unrelated to Peppol/XRechnung; carried here only to prove its mere
  // PRESENCE on the company changes nothing about this path — `formats/xrechnung-provider.ts` never
  // reads it, `peppol-transport.ts` never reads it.
  signingCertificate: 'unrelated-cert-blob',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

const COMPANY_WITHOUT_IBAN = { ...COMPANY_WITH_IBAN, iban: null };

// The German GOVERNMENT client: Leitweg-ID carried BOTH as the invoice's own `data.buyerReference`
// (BT-10, `b2g-routing/data/de.json`'s own `requiredDocumentFields`) AND as the client's OWN
// `PEPPOL_ENDPOINT` party identifier under EAS `0204` (`b2g-routing/data/de.json`'s own ADDENDUM,
// the codeliste + e-rechnung-bund.de citations) — TWO DIFFERENT mechanisms, the SAME underlying fact,
// exactly as that addendum documents.
const LEITWEG = '04011000-1234512345-06';
const GOVERNMENT_CLIENT = {
  id: 'client-1',
  name: 'Stadt Testhausen',
  address: 'Rathausplatz 1',
  city: 'Testhausen',
  postalCode: '10117',
  country: 'Germany',
  kind: 'GOVERNMENT',
  partyIdentifiers: [{ scheme: 'PEPPOL_ENDPOINT', value: `0204:${LEITWEG}` }],
};

const BUSINESS_CLIENT_DE = {
  id: 'client-2',
  name: 'Handel GmbH',
  address: 'Handelsstraße 2',
  city: 'Munich',
  postalCode: '80331',
  country: 'Germany',
  kind: 'BUSINESS',
  partyIdentifiers: [{ scheme: 'PEPPOL_ENDPOINT', value: '9930:DE999999999' }],
};

function documentData(overrides: Record<string, unknown> = {}) {
  return {
    client: 'client-1',
    issueDate: '2026-09-02',
    dueDate: '2026-10-02',
    currency: 'EUR',
    buyerReference: LEITWEG,
    lines: [{ description: 'Beratungsleistung', quantity: 1, unit: 'hour', unitPrice: 100, vatRate: '19' }],
    ...overrides,
  };
}

function draftDocument(data: Record<string, unknown>) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sendingDocument(data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'INV-2026-0001',
    ...overrides,
  };
}

/** The REAL `buildPeppolTransport`, wired the SAME way `documents-core.module.ts#buildTransportRegistry`
 *  wires it (including the `xrechnung` format override) — never a bare stub, matching the chorus-pro
 *  sibling's own "prove past the transport's own boundary" discipline. */
function buildRegistry() {
  const channelCredentials = {
    resolveActive: jest.fn().mockResolvedValue(CONNECTED_PEPPOL_CONFIG),
  } as unknown as ChannelCredentialsService;

  const transportRegistry = new TransportRegistry();
  transportRegistry.register(
    'peppol',
    'Peppol',
    buildPeppolTransport({
      channelCredentials,
      peppolBisFormatProvider,
      formatOverrides: {
        xrechnung: {
          provider: xrechnungFormatProvider,
          documentTypeId: PEPPOL_DOC_TYPES.INVOICE_XRECHNUNG_UBL,
        },
      },
    }),
  );

  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: jest.fn() } });
  return registry;
}

describe('B2G DE, end to end at the service level — government client + connected peppol channel, XRechnung format override', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email'); // irrelevant — B2G overrides it
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
  });

  it('a COMPLETE DE government client (Leitweg-ID + PEPPOL_ENDPOINT 0204 + company IBAN) — phase 1 preflight PASSES, phase 2 sends an ACTUAL XRechnung to the Access Point (CustomizationID proof), never Peppol BIS', async () => {
    (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
      applies: true,
      countryCode: 'DE',
      rule: DE_RULE,
      missingIdentifierSchemes: [],
    });
    mockedPrisma.company.findUnique.mockResolvedValue(COMPANY_WITH_IBAN);
    mockedPrisma.client.findUnique.mockResolvedValue(GOVERNMENT_CLIENT);

    const data = documentData();
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument(data));
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingDocument(data));

    const handler = buildRegistry().resolve('invoice', 'send');

    // ── Phase 1 (enqueue): the preflight PASSES — peppol is registered AND connected, the required
    // Leitweg-ID field is present, so B2G routing no longer refuses.
    const phase1 = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data,
      params: {},
    });
    expect(phase1.changed).toBe(true);
    expect(phase1.document).toMatchObject({ status: 'sending' });

    // ── Phase 2 (the worker replay, deliver()): capture the ACTUAL bytes handed to the Access Point.
    let capturedBody: { document: string; documentTypeId: string; receiver: string } | undefined;
    jest.spyOn(PeppolApHttpClient.prototype, 'send').mockImplementation(async (request) => {
      capturedBody = {
        document: Buffer.from(request.documentBytes).toString('base64'),
        documentTypeId: request.documentTypeId,
        receiver: request.receiverParticipantId,
      };
      return { messageId: 'msg-de-xrechnung-001', status: 'SENT' };
    });

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument(data));
    (persistence.updateDocumentStatus as jest.Mock).mockImplementation(
      (_companyId, _typeId, _documentId, status, _err, reference, providerId) =>
        Promise.resolve(
          sendingDocument(data, { status, transportRef: reference, channelProviderId: providerId }),
        ),
    );

    const phase2 = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data,
      params: {},
    });

    expect(phase2.changed).toBe(true);
    expect(phase2.document).toMatchObject({ status: 'sent', transportRef: 'msg-de-xrechnung-001' });
    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      'sent',
      null,
      'msg-de-xrechnung-001',
      'peppol',
    );

    // THE PROOF this task's own brief asks for: the payload that ACTUALLY reached the Access Point IS
    // an XRechnung — never a Peppol BIS document sent "by default" despite the DE rule's own override.
    expect(capturedBody).toBeDefined();
    expect(capturedBody!.documentTypeId).toBe(PEPPOL_DOC_TYPES.INVOICE_XRECHNUNG_UBL);
    const xml = Buffer.from(capturedBody!.document, 'base64').toString('utf-8');
    expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0');
    expect(xml).not.toContain('urn:fdc:peppol.eu:2017:poacc:billing:3.0');
    expect(xml).toContain(`<cbc:BuyerReference>${LEITWEG}</cbc:BuyerReference>`);
    // The receiver was addressed via the EXISTING, generic `PEPPOL_ENDPOINT` mechanism, under EAS
    // `0204` — `b2g-routing/data/de.json`'s own ADDENDUM (codeliste Peppol v9.7 + e-rechnung-bund.de).
    expect(capturedBody!.receiver).toBe(`0204:${LEITWEG}`);
  });

  // MUTATION GUARD — "l'endpoint Peppol manquant accepté" (this task's own brief): if
  // `peppol-transport.ts#send()`'s own receiver gate ever stopped refusing an absent
  // `PEPPOL_ENDPOINT`, THIS test is what would catch it for the B2G/DE path specifically (never only
  // at the bare-transport level `peppol-transport.spec.ts` already covers).
  it('the SAME government client with NO Peppol endpoint on file — the send REFUSES, named, at phase 2, never a silent success', async () => {
    (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
      applies: true,
      countryCode: 'DE',
      rule: DE_RULE,
      missingIdentifierSchemes: [],
    });
    mockedPrisma.company.findUnique.mockResolvedValue(COMPANY_WITH_IBAN);
    mockedPrisma.client.findUnique.mockResolvedValue({ ...GOVERNMENT_CLIENT, partyIdentifiers: [] }); // no PEPPOL_ENDPOINT

    const data = documentData();
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument(data));
    const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');

    const handler = buildRegistry().resolve('invoice', 'send');
    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/no Peppol endpoint on file/);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  // "sans IBAN → le refus XRechnung nommé" (task brief) — the FORMAT gate, not the receiver gate:
  // the client carries a valid Peppol endpoint, but the COMPANY (seller) has no IBAN, so
  // `xrechnungFormatProvider`'s own BR-DE-1 refuses — proving the format gate holds EVEN THOUGH the
  // send now goes through, rather than being blocked earlier by B2G routing or the receiver check.
  it('the SAME government client, but the COMPANY has NO IBAN — the XRechnung format gate refuses, named (BR-DE-1), never a fabricated IBAN, never a silent Peppol BIS fall back', async () => {
    (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
      applies: true,
      countryCode: 'DE',
      rule: DE_RULE,
      missingIdentifierSchemes: [],
    });
    mockedPrisma.company.findUnique.mockResolvedValue(COMPANY_WITHOUT_IBAN);
    mockedPrisma.client.findUnique.mockResolvedValue(GOVERNMENT_CLIENT);

    const data = documentData();
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument(data));
    const sendSpy = jest.spyOn(PeppolApHttpClient.prototype, 'send');

    const handler = buildRegistry().resolve('invoice', 'send');
    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/failed validation/);
    const error = await action.catch((e) => e);
    expect(error.response.errors.join(' ')).toContain('BR-DE-1');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  // "client business DE → peppol-bis inchangé" (task brief) — a BUSINESS client is NOT B2G-routed at
  // all (`resolveClientB2gRouting` returns `applies: false`), so the company's OWN free choice of
  // "peppol" applies, with NO `formatOverride` — the ordinary Peppol BIS payload, entirely unaffected
  // by the DE rule's own existence.
  it('a BUSINESS client in Germany (not B2G) sent via the company\'s OWN "peppol" choice — ordinary Peppol BIS, UNCHANGED, no format override at all', async () => {
    (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('peppol');
    // `COMPANY_WITH_IBAN` here for an UNRELATED reason to the assertion under test (Peppol BIS does
    // not gate on an IBAN the way XRechnung's own BR-DE-1 does): the base EN 16931 Schematron's own
    // German national subset (DE-R-001) requires BG-16 "PAYMENT INSTRUCTIONS" whenever BOTH parties
    // are German, regardless of Peppol BIS vs. XRechnung — using the IBAN-carrying fixture keeps this
    // test isolated to its OWN single variable (format choice), never entangled with that unrelated
    // base-layer German rule.
    mockedPrisma.company.findUnique.mockResolvedValue(COMPANY_WITH_IBAN);
    mockedPrisma.client.findUnique.mockResolvedValue(BUSINESS_CLIENT_DE);

    const data = documentData({ client: 'client-2', buyerReference: 'PO-2026-00099' });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument(data));
    (persistence.updateDocumentStatus as jest.Mock).mockImplementation(
      (_companyId, _typeId, _documentId, status, _err, reference, providerId) =>
        Promise.resolve(
          sendingDocument(data, { status, transportRef: reference, channelProviderId: providerId }),
        ),
    );

    let capturedDocumentTypeId: string | undefined;
    jest.spyOn(PeppolApHttpClient.prototype, 'send').mockImplementation(async (request) => {
      capturedDocumentTypeId = request.documentTypeId;
      return { messageId: 'msg-business-001', status: 'SENT' };
    });

    const handler = buildRegistry().resolve('invoice', 'send');
    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data,
      params: {},
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sent', transportRef: 'msg-business-001' });
    expect(capturedDocumentTypeId).toBe(PEPPOL_DOC_TYPES.INVOICE_UBL); // Peppol BIS's own URN, never XRechnung's
  });
});
