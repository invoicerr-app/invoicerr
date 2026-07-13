/**
 * M-1 (COMPLIANCE_AUDIT.md) — format validation is live and BLOCKING end-to-end.
 *
 * Before this fix: `FormatProviderRegistry.buildAll()` called `provider.validate()` and threw the
 * result away (registry.ts:68); `ComplianceService.validate()` was a hardcoded `valid: true` stub;
 * nothing stopped `send()` from transmitting a structurally invalid CII/FA_VAT/FatturaPA.
 *
 * These tests drive the REAL pipeline (ComplianceService.issue() → send() → ComplianceExecutor
 * .execute() → FormatProviderRegistry.buildAll() → provider.validate()) with a real
 * InvoiceArtifactPort backed by InvoiceRenderingService (same pattern as
 * execution/peppol-f7-reachability.spec.ts) and PROVEN-valid fixtures from
 * providers/format/__fixtures__/invoices.ts, to prove:
 *   1. A genuinely valid FR (EN16931_CII), PL (FA_VAT), IT (FatturaPA) document passes validation
 *      and proceeds past the format gate (send() does not throw, no VALIDATION_BLOCKED event).
 *   2. The same documents, deliberately broken the same way the existing per-provider negative
 *      tests already do (missing SellerTradeParty / Naglowek / DatiTrasmissione), are BLOCKED:
 *      send() throws, the document never advances past ISSUED, and a first-class VALIDATION_BLOCKED
 *      event is recorded (F-9 sincerity pattern — never a swallowed log line).
 *   3. A Schematron *warning*-level-only finding (XRechnung's documented BR-DE-style data gap) does
 *      NOT block — ComplianceService.validate() and the provider both report valid:true.
 */
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { ComplianceExecutor } from '../execution/executor';
import { RecordingComplianceLogger } from '../execution/logger';
import { RenderedArtifact } from '../execution/types';
import { NumberingRegistry } from '../lifecycle/numbering';
import { En16931FormatProvider } from '../providers/format/providers';
import { FR_B2B_STANDARD, IT_B2B, PL_B2B, DE_B2B } from '../providers/format/__fixtures__/invoices';
import { InvoiceArtifactPort, XmlExportFormat } from '../providers/format/invoice-artifact-port';
import { FormatProviderRegistry } from '../providers/format/registry';
import { InvoiceMailPort } from '../providers/transmission/invoice-mail-port';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { ComplianceService } from './compliance-service';
import { InMemoryComplianceDocumentStore } from './document-store';

const renderService = new InvoiceRenderingService();

/** Default port: every artifact is a stub (empty bytes) — each provider takes its "no bytes, skip
 *  validation" path. Individual tests override just the syntax under test. */
function makePort(overrides: Partial<InvoiceArtifactPort> = {}): InvoiceArtifactPort {
  return {
    renderPdf: async () => new Uint8Array(),
    renderPdfFormat: async () => new Uint8Array(),
    renderXmlFormat: async () => '',
    renderFatturaPa: async () => '',
    renderCfdi: async () => '',
    renderFacturae: async () => '',
    renderKsaUbl: async () => '',
    renderFaVat: async () => '',
    renderNationalXml: async () => '',
    ...overrides,
  };
}

/** Mirrors the real gateway that IS injected in prod (see compliance-service.spec.ts's mailMock). */
function mailMock(): InvoiceMailPort {
  return { sendInvoiceEmail: async () => ({ sent: true }) };
}

function party(country: string): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role: 'B2B',
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

function ctx(supplier: string, buyer: string, externalRef: string): TransactionContext {
  return {
    supplier: party(supplier),
    buyer: party(buyer),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    externalRef,
  };
}

function svc(port: InvoiceArtifactPort) {
  const log = new RecordingComplianceLogger();
  const formats = new FormatProviderRegistry({ artifacts: port });
  const transmission = new TransmissionProviderRegistry({ mail: mailMock() });
  const executor = new ComplianceExecutor({
    formats,
    transmission,
    numbering: new NumberingRegistry(),
    logger: log,
  });
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    executor,
    formats,
    logger: log,
  });
  return { service, log };
}

describe('M-1 — valid documents proceed past the format-validation gate', () => {
  it('FR (EN16931_CII authoritative / Factur-X human): valid CII passes, send() does not throw, no VALIDATION_BLOCKED event', async () => {
    const port = makePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) =>
        renderService.buildEInvoice(FR_B2B_STANDARD.data).exportXml(format),
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('FR', 'DE', 'inv-fr-valid'));
    const { document: issued } = await service.issue(draft.id);
    expect(issued.status).toBe('ISSUED');

    const { document } = await service.send(draft.id);
    expect(document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    // Moved past the format gate — email (mocked) accepts, so delivery proceeds (FR then opens its
    // bidirectional response window, per plan.lifecycle.response) instead of staying at ISSUED.
    expect(document.status).not.toBe('ISSUED');
    expect(document.events.some((e) => e.type === 'DELIVER')).toBe(true);
  });

  it('PL (FA_VAT/KSeF): valid FA_VAT passes, send() does not throw, no VALIDATION_BLOCKED event', async () => {
    const port = makePort({ renderFaVat: async () => renderService.buildFaVat(PL_B2B.data) });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('PL', 'PL', 'inv-pl-valid'));
    await service.issue(draft.id);

    const { document } = await service.send(draft.id);
    expect(document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    // No KSeF credentials configured in this test → channel SKIPPED → TRANSMISSION_FAILED is the
    // honest F-4 outcome; the point here is only that validation itself did not block the attempt.
    expect(document.status).not.toBe('ISSUED');
  });

  it('IT (FatturaPA/SdI): valid FatturaPA passes, send() does not throw, no VALIDATION_BLOCKED event', async () => {
    const port = makePort({ renderFatturaPa: async () => renderService.buildFatturaPa(IT_B2B.data) });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('IT', 'IT', 'inv-it-valid'));
    await service.issue(draft.id);

    const { document } = await service.send(draft.id);
    expect(document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    expect(document.status).not.toBe('ISSUED');
  });
});

describe('M-1 — invalid documents are BLOCKED before transmission', () => {
  it('FR: CII missing SellerTradeParty (BR-06/BR-07) is blocked — send() throws, doc stays ISSUED, VALIDATION_BLOCKED recorded', async () => {
    const port = makePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) => {
        const xml = await renderService.buildEInvoice(FR_B2B_STANDARD.data).exportXml(format);
        // Same corruption technique already proven in format-validation.spec.ts's Schematron
        // negative test — strips a mandatory EN16931 party block.
        return format === 'cii'
          ? xml.replace(/<ram:SellerTradeParty>[\s\S]*?<\/ram:SellerTradeParty>/, '')
          : xml;
      },
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('FR', 'DE', 'inv-fr-invalid'));
    const { document: issued } = await service.issue(draft.id);
    expect(issued.status).toBe('ISSUED');

    await expect(service.send(draft.id)).rejects.toThrow(/format validation failed/i);

    const after = await service.getDocument(draft.id);
    // Never advanced to DELIVERED/PENDING_CLEARANCE/TRANSMISSION_FAILED — stayed exactly where the
    // F-9 numbering-blocked case stays: at its last legitimate pre-failure status.
    expect(after!.status).toBe('ISSUED');
    const blocked = after!.events.find((e) => e.type === 'VALIDATION_BLOCKED');
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toMatch(/EN16931_CII/);
    expect(blocked!.payload).toEqual(
      expect.arrayContaining([expect.objectContaining({ syntax: 'EN16931_CII' })]),
    );
  });

  it('PL: FA_VAT missing Naglowek is blocked — send() throws, doc stays ISSUED, VALIDATION_BLOCKED recorded', async () => {
    const port = makePort({
      renderFaVat: async () => {
        const xml = await renderService.buildFaVat(PL_B2B.data);
        // Same corruption already proven in format-schema-validation.spec.ts's FA_VAT negative test.
        return xml.replace(/<Naglowek>[\s\S]*?<\/Naglowek>/, '');
      },
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('PL', 'PL', 'inv-pl-invalid'));
    await service.issue(draft.id);

    await expect(service.send(draft.id)).rejects.toThrow(/format validation failed/i);

    const after = await service.getDocument(draft.id);
    expect(after!.status).toBe('ISSUED');
    const blocked = after!.events.find((e) => e.type === 'VALIDATION_BLOCKED');
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toMatch(/FA_VAT/);
  });

  it('IT: FatturaPA missing DatiTrasmissione is blocked — send() throws, doc stays ISSUED, VALIDATION_BLOCKED recorded', async () => {
    const port = makePort({
      renderFatturaPa: async () => {
        const xml = await renderService.buildFatturaPa(IT_B2B.data);
        // Same corruption already proven in format-schema-validation.spec.ts's FatturaPA negative test.
        return xml.replace(/<DatiTrasmissione>[\s\S]*?<\/DatiTrasmissione>/, '');
      },
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('IT', 'IT', 'inv-it-invalid'));
    await service.issue(draft.id);

    await expect(service.send(draft.id)).rejects.toThrow(/format validation failed/i);

    const after = await service.getDocument(draft.id);
    expect(after!.status).toBe('ISSUED');
    const blocked = after!.events.find((e) => e.type === 'VALIDATION_BLOCKED');
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toMatch(/FATTURAPA/);
  });
});

describe('M-1/M-9 — base EN16931-UBL blocks XRECHNUNG, the real KoSIT BR-DE delta stays advisory', () => {
  it('XRechnung DE→DE: base EN16931-UBL passes (valid:true), the real BR-DE-5 seller-contact gap is surfaced as a non-blocking warning', async () => {
    const provider = new En16931FormatProvider();
    const log = new RecordingComplianceLogger();
    // DE_B2B's buyer is French by default (so the DE-specific delta never even fires — see
    // providers.ts). Force a DE→DE pair, the scenario XRechnung's CIUS rules actually target.
    const deToDeData = {
      ...DE_B2B.data,
      client: {
        ...DE_B2B.data.client,
        country: 'Germany',
        partyIdentifiers: [{ scheme: 'VAT', value: 'DE987654321' }],
      },
    };
    const xml = await renderService.buildEInvoice(deToDeData).exportXml('xrechnung');
    const artifact: RenderedArtifact = {
      role: 'AUTHORITATIVE',
      syntax: 'XRECHNUNG',
      mime: 'application/xml',
      bytes: new TextEncoder().encode(xml),
    };
    const report = await provider.validate(artifact, log);

    // M-9 part 3: XRECHNUNG is now validated against the REAL, official base EN16931-UBL
    // Schematron (ConnectingEurope/eInvoicing-EN16931) — BLOCKING — and it passes clean for this
    // fixture (report.valid / errors reflect ONLY the base ruleset's outcome). KoSIT's own
    // XRechnung-UBL delta (itplr-kosit/xrechnung-schematron, the real BR-DE-* rules) is also run,
    // but its findings are merged into `warnings`, never `errors`: it correctly and repeatedly
    // fires BR-DE-5 ("Seller contact point"/BT-41 must be present) because buildEInvoice() never
    // emits cac:Contact/cbc:Name — a real, currently-open, systemic data gap tracked as a
    // follow-up (see providers.ts XRECHNUNG branch comment), not blocked here on purpose so
    // XRechnung documents can still be sent today.
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.some((w) => w.includes('BR-DE-5'))).toBe(true);
  });
});

describe('M-1 — ComplianceService.validate() pre-flight aggregates real per-artifact reports', () => {
  it('valid FR document → { valid: true, errors: [] }', async () => {
    const port = makePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) =>
        renderService.buildEInvoice(FR_B2B_STANDARD.data).exportXml(format),
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('FR', 'DE', 'inv-fr-preflight-valid'));
    await service.issue(draft.id);

    const result = await service.validate(draft.id);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('broken FR document → { valid: false, errors: [...real Schematron findings...] }', async () => {
    const port = makePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) => {
        const xml = await renderService.buildEInvoice(FR_B2B_STANDARD.data).exportXml(format);
        return format === 'cii'
          ? xml.replace(/<ram:SellerTradeParty>[\s\S]*?<\/ram:SellerTradeParty>/, '')
          : xml;
      },
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('FR', 'DE', 'inv-fr-preflight-invalid'));
    await service.issue(draft.id);

    const result = await service.validate(draft.id);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('BR-06') || e.includes('BR-07'))).toBe(true);
    // validate() is read-only — it must not have mutated the document's status.
    const after = await service.getDocument(draft.id);
    expect(after!.status).toBe('ISSUED');
  });
});
