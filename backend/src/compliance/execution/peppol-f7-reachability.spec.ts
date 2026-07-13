/**
 * F-7 full-path reachability test — COMPLIANCE_AUDIT.md §F-7.
 *
 * Before the fix: `compliance-engine.ts` `buildArtifacts()` only ever emitted the profile's
 * primary/human/buyer artifacts, never cross-checking them against the plan's *channels*. DE
 * (primary XRECHNUNG) and ES (primary ES_FACTURAE) both declare a PEPPOL channel, but no
 * Peppol-compatible artifact (PEPPOL_BIS / EN16931_UBL / EN16931_CII — the exact search order in
 * `peppol-transmission.ts`) was ever built for them, so `PeppolTransmissionProvider.transmit()`
 * always found nothing and returned SKIPPED. FR only ever worked by luck (its primary syntax,
 * EN16931_CII, already satisfies the Peppol provider's search).
 *
 * This spec drives the REAL, unmodified pipeline end to end:
 *
 *   resolve(DE|ES) → ComplianceExecutor.execute() → FormatProviderRegistry.buildAll()
 *     → PeppolTransmissionProvider.transmit()
 *
 * and proves (a) the plan now carries a PEPPOL_BIS artifact, (b) the executor actually builds it
 * (non-empty bytes), and (c) the Peppol provider receives it and does NOT return SKIPPED.
 *
 * The PEPPOL_BIS/UBL bytes are produced by the REAL En16931FormatProvider →
 * InvoiceRenderingService.buildEInvoice().exportXml('ubl') pipeline — the same builder
 * peppol-sh-live.spec.ts drives against the real peppol.sh sandbox (2026-07-11 live proof) — never
 * hand-written XML, and never derived from the country's own primary syntax (XRechnung for DE,
 * Facturae for ES go through entirely different format providers). This is what proves ES's UBL
 * is genuinely built from the canonical invoice model, not from its Facturae artifact.
 *
 * No HTTP calls: the Peppol AP + SMP ports are injected fakes (same pattern as
 * peppol/peppol-transmission.spec.ts and execution/executor-e2e.spec.ts).
 */
import { InvoiceRenderingService } from '../../modules/invoice-rendering/invoice-rendering.service';
import { TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { ComplianceExecutor } from './executor';
import { NumberingRegistry } from '../lifecycle/numbering';
import { DE_B2B, ES_B2B } from '../providers/format/__fixtures__/invoices';
import { InvoiceArtifactPort, XmlExportFormat } from '../providers/format/invoice-artifact-port';
import { FormatProviderRegistry } from '../providers/format/registry';
import {
  ChannelCredentialsPort,
  ResolvedChannelConfig,
} from '../providers/transmission/channel-credentials-port';
import { PeppolTransmissionProvider } from '../providers/transmission/providers';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import {
  PeppolApPort,
  PeppolSendResult,
  PeppolStatusResult,
  PEPPOL_DOC_TYPES,
} from '../providers/transmission/peppol/peppol-client';
import { SmpLookupPort, SmpLookupResult } from '../providers/transmission/peppol/smp-client';
import type { InvoiceRenderData } from '../../modules/invoice-rendering/invoice-rendering.service';

const renderService = new InvoiceRenderingService();

/**
 * A real InvoiceArtifactPort backed by the actual rendering pipeline (no DB — buildEInvoice()
 * takes plain data, exactly like peppol-sh-live.spec.ts). renderXmlFormat is genuinely wired: it
 * asks @e-invoice-eu/core for the requested export ('ubl' for PEPPOL_BIS, 'xrechnung' for
 * XRECHNUNG) from the SAME canonical fixture data regardless of which syntax is requested — proof
 * that the PEPPOL_BIS/UBL artifact is not derived from any other rendered syntax. Everything else
 * (PDF/national XML) is a minimal stub — irrelevant to what this spec asserts.
 */
function makeArtifactPort(fixtureData: InvoiceRenderData): InvoiceArtifactPort {
  return {
    renderPdf: async () => new Uint8Array(),
    renderPdfFormat: async () => new Uint8Array(),
    renderXmlFormat: async (_invoiceId: string, format: XmlExportFormat) => {
      const inv = renderService.buildEInvoice(fixtureData);
      return inv.exportXml(format);
    },
    // M-1: these providers now run real, blocking format validation (XSD/Schematron). '<stub/>' is
    // not a valid document for any of them and would fail that gate — return '' instead so each
    // provider takes its "no real bytes, nothing to validate" stub path, matching the "irrelevant
    // to what this spec asserts" intent above (only PEPPOL_BIS/UBL is exercised here).
    renderFatturaPa: async () => '',
    renderCfdi: async () => '',
    renderFacturae: async () => '',
    renderKsaUbl: async () => '',
    renderFaVat: async () => '',
    renderNationalXml: async () => '',
  };
}

/** Only resolves for the 'peppol' providerId — any other channel (e.g. ES's es-aeat GOV_PORTAL_API,
 *  unrelated to this F-7 test) correctly sees "not configured for company", exactly like prod. */
function mockCredentials(config: ResolvedChannelConfig): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn((_companyId: string, providerId: string) =>
      Promise.resolve(providerId === 'peppol' ? config : null),
    ),
  };
}

function mockApPort(messageId: string): PeppolApPort {
  return {
    send: jest.fn().mockResolvedValue({ messageId, status: 'QUEUED' } satisfies PeppolSendResult),
    getStatus: jest.fn().mockResolvedValue({ messageId, status: 'DELIVERED' } satisfies PeppolStatusResult),
    sendInvoiceResponse: jest.fn().mockResolvedValue({ messageId: `${messageId}-resp`, status: 'SENT' }),
  };
}

function mockSmpPort(): SmpLookupPort {
  return {
    lookup: jest.fn().mockResolvedValue({
      endpoint: {
        url: 'https://ap.receiver.example.com/as4',
        transportProfile: 'peppol-transport-as4-v2_0',
      },
      documentTypeIds: [PEPPOL_DOC_TYPES.INVOICE_UBL],
    } satisfies SmpLookupResult),
  };
}

function makeCtx(country: string, companyId: string, receiverPeppolId: string): TransactionContext {
  return {
    supplier: {
      legalName: `${country} Supplier Co`,
      countryCode: country,
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: `${country}123456789`, validated: true }],
    },
    buyer: {
      legalName: `${country} Buyer Co`,
      countryCode: country,
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: `${country}987654321`, validated: true }],
      peppolId: receiverPeppolId,
    },
    lines: [
      { id: 'l1', description: 'test service', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' },
    ],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    supplierCompanyId: companyId,
    externalRef: `INV-F7-${companyId}`,
  } as TransactionContext;
}

const RECEIVER_PEPPOL_ID = '0009:98765432100022';

/** Wires one full pipeline instance (engine plan + executor + injected Peppol fakes) per country. */
function setup(country: 'DE' | 'ES', fixtureData: InvoiceRenderData) {
  const companyId = `company-f7-${country.toLowerCase()}`;
  const ctx = makeCtx(country, companyId, RECEIVER_PEPPOL_ID);
  const plan = resolve(ctx);

  const formats = new FormatProviderRegistry({ artifacts: makeArtifactPort(fixtureData) });

  const resolvedConfig: ResolvedChannelConfig = {
    providerId: 'peppol',
    channel: 'PEPPOL',
    environment: 'TEST',
    config: {
      participantId: `0009:${country}123456789`,
      accessPointUrl: 'https://ap.example.com',
      apiKey: 'test-api-key',
      environment: 'TEST',
    },
    isActive: true,
  };
  const credentials = mockCredentials(resolvedConfig);
  const apPort = mockApPort(`msg-f7-${country.toLowerCase()}`);
  const smpPort = mockSmpPort();

  // Object-form constructor wires `this.credentials` (needed by transmitAll's config-resolution
  // step); then the default 'peppol' provider is swapped for one carrying injected AP/SMP fakes —
  // same "construct default registry, then patch byId/byChannel" pattern as executor-e2e.spec.ts.
  const transmission = new TransmissionProviderRegistry({ credentials });
  const peppolProvider = new PeppolTransmissionProvider(credentials, apPort, smpPort);
  (transmission as unknown as { byId: Map<string, unknown> }).byId.set('peppol', peppolProvider);
  (transmission as unknown as { byChannel: Map<string, unknown> }).byChannel.set('PEPPOL', peppolProvider);

  const executor = new ComplianceExecutor({ formats, transmission, numbering: new NumberingRegistry() });

  return { plan, ctx, executor, apPort, credentials };
}

describe.each([
  ['DE', DE_B2B.data, 'XRECHNUNG'],
  ['ES', ES_B2B.data, 'ES_FACTURAE'],
] as const)('F-7 — %s → PEPPOL, full path resolve() → execute() → transmit()', (country, fixtureData, primarySyntax) => {
  it(`plan.channels includes PEPPOL and plan.artifacts contains a PEPPOL_BIS artifact alongside the primary ${primarySyntax}`, () => {
    const { plan } = setup(country, fixtureData);
    expect(plan.channels.map((c) => c.type)).toContain('PEPPOL');
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'AUTHORITATIVE', syntax: primarySyntax }),
        expect.objectContaining({ syntax: 'PEPPOL_BIS' }),
      ]),
    );
  });

  it('executor builds a non-empty PEPPOL_BIS artifact via the real UBL builder (not derived from another syntax)', async () => {
    const { plan, ctx, executor } = setup(country, fixtureData);
    const result = await executor.execute(ctx, plan);

    const peppolArtifact = result.artifacts.find((a) => a.syntax === 'PEPPOL_BIS');
    expect(peppolArtifact).toBeTruthy();
    expect(peppolArtifact!.mime).toBe('application/xml');

    const xml = Buffer.from(peppolArtifact!.bytes).toString('utf-8');
    // Genuine UBL Invoice output from @e-invoice-eu/core, built directly from the canonical
    // fixture data — not a stub (non-trivial length) and not Facturae/XRechnung markup.
    expect(xml.length).toBeGreaterThan(200);
    expect(xml).toContain('Invoice');
    expect(xml).not.toContain('Facturae'); // never derived from the ES_FACTURAE artifact
  });

  it('executor hands the PEPPOL_BIS artifact to the Peppol provider — transmission is NOT SKIPPED', async () => {
    const { plan, ctx, executor, apPort, credentials } = setup(country, fixtureData);
    const result = await executor.execute(ctx, plan);

    expect(credentials.resolveActive).toHaveBeenCalledWith(ctx.supplierCompanyId, 'peppol');

    const peppolResult = result.transmissions.find((t) => t.channel === 'PEPPOL');
    expect(peppolResult).toBeTruthy();
    // Hard assertion (ksef-mock-tests-false-confidence pattern): SKIPPED/REJECTED fail the test.
    expect(peppolResult!.status).not.toBe('SKIPPED');
    expect(peppolResult!.status).not.toBe('REJECTED');
    expect(['PENDING', 'SENT']).toContain(peppolResult!.status);

    // The AP adapter actually received a non-empty document — proof the artifact reached corner 2.
    expect(apPort.send).toHaveBeenCalledTimes(1);
    const sendArg = (apPort.send as jest.Mock).mock.calls[0][0];
    expect(sendArg.documentTypeId).toBe(PEPPOL_DOC_TYPES.INVOICE_UBL);
    expect(Buffer.isBuffer(sendArg.documentBytes)).toBe(true);
    expect(sendArg.documentBytes.length).toBeGreaterThan(0);
  });
});
