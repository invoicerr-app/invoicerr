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
import {
  InvoiceRenderingService,
  peppolEasForVat,
} from '@/modules/invoice-rendering/invoice-rendering.service';
import type { InvoiceRenderData } from '@/modules/invoice-rendering/render-data';
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
    // What this test is about: the FORMAT gate. A valid CII must not raise VALIDATION_BLOCKED and
    // send() must not throw.
    expect(document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    // It moved past the gate — the document did not stay at ISSUED.
    expect(document.status).not.toBe('ISSUED');
    // FR-D1: it no longer reaches DELIVER here. EMAIL was removed from France's post-2026-09-01
    // channels as illicit, and this harness configures no PDP/PEPPOL credentials, so transmission
    // honestly fails. That is downstream of the format gate and does not weaken what is asserted
    // above; the transmission gap itself is asserted in compliance-service.spec.ts.
    expect(document.status).toBe('TRANSMISSION_FAILED');
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
  it('XRechnung DE→DE: base EN16931-UBL passes (valid:true), and the formerly-open BR-DE-5 seller-contact gap is now CLOSED', async () => {
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

    // M-9 part 3: XRECHNUNG is validated against the REAL, official base EN16931-UBL Schematron
    // (ConnectingEurope/eInvoicing-EN16931) — BLOCKING — and it passes clean for this fixture
    // (report.valid / errors reflect ONLY the base ruleset's outcome). KoSIT's own XRechnung-UBL
    // delta (itplr-kosit/xrechnung-schematron, the real BR-DE-* rules) is also run and merged into
    // `warnings` (still non-blocking overall — see providers.ts XRECHNUNG branch comment for the
    // one remaining reason: BR-DE-16 seller-VAT data gap on sellers with neither a VAT nor a tax
    // registration id). The #14 fix closed the Contact/Name gap specifically: buildEInvoice() now
    // always emits cac:Contact/cbc:Name (falling back to the company name), so BR-DE-5/6/7 no
    // longer fire for THIS fixture (DE_B2B's seller carries a VAT identifier). The only remaining
    // warning here is BR-DE-21 (CustomizationID) — cosmetic, expected: this test calls
    // buildEInvoice().exportXml() directly, bypassing provider.build()'s XRechnung-specific
    // CustomizationID string substitution, which only applies on the real build() path.
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings.some((w) => w.includes('BR-DE-5'))).toBe(false);
    expect(report.warnings.some((w) => w.includes('BR-DE-6'))).toBe(false);
    expect(report.warnings.some((w) => w.includes('BR-DE-7'))).toBe(false);
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

describe('FR→BE intra-EU B2B service — CI-red investigation (fr-be Business Scenario, commit a5f77310+)', () => {
  // Studio Lyon SARL (FR, SIRET-only — no seller VAT identifier) → Brussels Retail NV (BE, VAT
  // BE0123456789), 21% "standard rated" consulting line. This is the ORIGINAL fr-be e2e fixture
  // shape (e2e/cypress/fixtures/scenarios.ts) that made the "Business Scenarios" CI job's
  // scenario(fr-be) matrix entry fail on every run since M-1 made format validation blocking:
  // EN16931 BR-S-02 correctly rejects a "Standard rated" line with no Seller VAT/tax-registration
  // identifier present. This was never a Schematron/builder bug — the data was genuinely invalid.
  const frSellerNoVat: InvoiceRenderData['company'] = {
    name: 'Studio Lyon SARL',
    description: null,
    foundedAt: null,
    currency: 'EUR',
    address: '1 Rue de la Fixture',
    city: 'Lyon',
    postalCode: '69001',
    country: 'France',
    partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '73282932000074' }],
  };
  const beBuyer: InvoiceRenderData['client'] = {
    type: 'COMPANY',
    name: 'Brussels Retail NV',
    description: null,
    foundedAt: null,
    contactFirstname: null,
    contactLastname: null,
    salutation: null,
    sex: null,
    title: null,
    isActive: true,
    address: '10 Rue de la Loi',
    city: 'Brussels',
    postalCode: '1000',
    country: 'Belgium',
    partyIdentifiers: [{ scheme: 'VAT', value: 'BE0123456789' }],
  };

  it('the ORIGINAL fr-be data (standard-rated 21%, no seller VAT id) is genuinely invalid — BLOCKED on BR-S-02, not a false positive', async () => {
    const data: InvoiceRenderData = {
      rawNumber: 'INV-2025-0001',
      number: null,
      issuedAt: new Date('2025-06-15'),
      createdAt: new Date('2025-06-15'),
      company: frSellerNoVat,
      client: beBuyer,
      items: [{ name: 'Consulting', quantity: 5, unitPrice: 200, vatRate: 21, type: 'SERVICE' }],
    };
    const port = makePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) =>
        renderService.buildEInvoice(data).exportXml(format),
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('FR', 'BE', 'inv-fr-be-original'));
    await service.issue(draft.id);

    await expect(service.send(draft.id)).rejects.toThrow(/format validation failed/i);

    const after = await service.getDocument(draft.id);
    expect(after!.status).toBe('ISSUED');
    const blocked = after!.events.find((e) => e.type === 'VALIDATION_BLOCKED');
    expect(blocked).toBeDefined();
    expect(JSON.stringify(blocked!.payload)).toContain('BR-S-02');
  });

  it('the FIXED fr-be data (reverse charge: seller VAT id + 0% AE, per Art. 44/196 Directive 2006/112/EC) passes — send() does not throw, no VALIDATION_BLOCKED', async () => {
    const data: InvoiceRenderData = {
      rawNumber: 'INV-2025-0001',
      number: null,
      issuedAt: new Date('2025-06-15'),
      createdAt: new Date('2025-06-15'),
      company: {
        ...frSellerNoVat,
        partyIdentifiers: [
          { scheme: 'LEGAL_ID', value: '73282932000074' },
          { scheme: 'VAT', value: 'FR44732829320' },
        ],
      },
      client: beBuyer,
      // Reverse charge: the FR seller does not charge VAT — the BE buyer self-accounts.
      items: [{ name: 'Consulting', quantity: 5, unitPrice: 200, vatRate: 0, type: 'SERVICE' }],
    };
    const port = makePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) =>
        renderService.buildEInvoice(data).exportXml(format),
    });
    const { service } = svc(port);
    const draft = await service.createDraft(ctx('FR', 'BE', 'inv-fr-be-fixed'));
    await service.issue(draft.id);

    const { document } = await service.send(draft.id);
    expect(document.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    expect(document.status).not.toBe('ISSUED');

    // Confirm the rendered CII actually used the "AE" (Reverse charge) category, not a plain "S"/"Z".
    const xml = await renderService.buildEInvoice(data).exportXml('cii');
    expect(xml).toContain('<ram:CategoryCode>AE</ram:CategoryCode>');
    expect(xml).toContain('VATEX-EU-AE');

    // The BE buyer (VAT-only, no legal id) endpoint must resolve to Belgium's VAT EAS code 9925,
    // derived from the "BE" VAT prefix via the verified Peppol EAS map — NOT a hardcode and NOT the
    // 'EM' fallback (which would fail Peppol-BIS PEPPOL-EN16931-CL008).
    const ubl = await renderService.buildEInvoice(data).exportXml('ubl');
    const buyerBlock = ubl.slice(ubl.indexOf('AccountingCustomerParty'));
    expect(buyerBlock).toContain('schemeID="9925"');
    expect(buyerBlock).toContain('BE0123456789');
    expect(buyerBlock).not.toContain('schemeID="EM"');
  });

  it('peppolEasForVat derives each VAT identifier its OWN country VAT EAS code (verified against the OpenPeppol codelist), undefined for unmapped/malformed', () => {
    // Every code verified against OpenPeppol "Participant identifier schemes" (docs.peppol.eu) and
    // present in the vendored eaid enumeration (schemas/peppol/PEPPOL-EN16931-UBL.sch) so it passes
    // PEPPOL-EN16931-CL008. 9925 is Belgium-specific, NOT a generic EU VAT code.
    expect(peppolEasForVat('BE0123456789')).toBe('9925'); // Belgium
    expect(peppolEasForVat('FR44732829320')).toBe('9957'); // France
    expect(peppolEasForVat('DE987654321')).toBe('9930'); // Germany
    expect(peppolEasForVat('IT12345678901')).toBe('0211'); // Italy — PARTITA IVA (not 0210 CF)
    expect(peppolEasForVat('ES12345678A')).toBe('9920'); // Spain
    expect(peppolEasForVat('EL123456789')).toBe('9933'); // Greece — VAT prefix EL, not ISO "GR"
    expect(peppolEasForVat('nl123456789b01')).toBe('9944'); // Netherlands (case-insensitive)
    // Member states with no dedicated CL008-valid VAT EAS → undefined → caller falls back to email.
    expect(peppolEasForVat('DK12345678')).toBeUndefined();
    expect(peppolEasForVat('SE123456789012')).toBeUndefined();
    expect(peppolEasForVat(null)).toBeUndefined();
    expect(peppolEasForVat('')).toBeUndefined();
  });
});
