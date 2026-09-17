/**
 * Received-invoice extraction's OWN master proof: every extraction path runs against XML/PDF our OWN outbound
 * providers (`cii-provider.ts`/`ubl-provider.ts`/`facturx-provider.ts`) actually produce — never a
 * hand-written XML fixture, and never `@e-invoice-eu/core`'s `fromXml` (the documented CII round-trip
 * bug this module's own header explains avoiding). The exact fixture (seller/buyer/lines) and its
 * hand-computed totals are copied verbatim from `formats/providers.spec.ts` ("Hand-computed") so the
 * expected numbers here are independently traceable to the same arithmetic that
 * file already proves against the REAL vendored EN 16931 Schematron.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ciiFormatProvider } from '../formats/cii-provider';
import { buildFacturxFormatProvider } from '../formats/facturx-provider';
import { DocumentFormatParty } from '../formats/format-provider';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { ublFormatProvider } from '../formats/ubl-provider';
import { extractReceivedInvoiceFields } from './extraction';

jest.mock('../rendering/render-instance-pdf');

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** Same seller/buyer `formats/providers.spec.ts` uses — a seller the vendored Schematron actually
 *  accepts (VAT + SIRET on file), so the generated artifacts are genuinely valid EN 16931 output, not
 *  merely well-formed XML. */
const SELLER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  phone: '+33102030405',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'LEGAL_ID', value: '12345678900017' },
  ],
};

const BUYER: DocumentFormatParty = {
  name: 'Acme GmbH',
  address: 'Friedrichstraße 42',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

/**
 * Hand-computed (copied from `formats/providers.spec.ts`):
 *   line 1: 10 × 1200.00 = 12000.00
 *   line 2:  2 ×  800.00 =  1600.00
 *   net    = 13600.00 ; VAT (20%) = 2720.00 ; gross = 16320.00
 */
const DOCUMENT_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  notes: 'Merci de votre confiance.',
  lines: [
    { description: 'Conseil stratégique', quantity: 10, unit: 'hour', unitPrice: 1200, vatRate: '20' },
    { description: 'Formation équipe', quantity: 2, unit: 'day', unitPrice: 800, vatRate: '20' },
  ],
};

const DOCUMENT = {
  id: 'doc-1',
  data: DOCUMENT_DATA,
  displayNumber: 'INV-2026-0001',
  status: 'sent',
  createdAt: new Date('2026-08-30'),
};

/** BG-25, both syntaxes — read off `DOCUMENT_DATA.lines` above via BT-153/BT-129/BT-146/BT-152 (never
 *  BT-131 — see extraction.ts's own header on why `unitPrice`, not the line's own net total, is what
 *  round-trips exactly through `compute-totals.ts`'s existing quantity×unitPrice engine here: no
 *  discount on either line, so this fixture's own `LineExtensionAmount`/`LineTotalAmount` (12000.00,
 *  1600.00) already equal quantity×unitPrice exactly). `vatRate` is the RAW TEXT the generator wrote
 *  ("20"), matching the 'select' field kind's own string convention. */
const EXPECTED_LINES = [
  { description: 'Conseil stratégique', quantity: 10, unitPrice: 1200, vatRate: '20' },
  { description: 'Formation équipe', quantity: 2, unitPrice: 800, vatRate: '20' },
];

describe('received-invoices/extraction — proven against OUR OWN outbound artifacts', () => {
  it('CII: every field extracted matches the hand-computed fixture exactly', async () => {
    const built = await ciiFormatProvider.build(descriptor, DOCUMENT, SELLER, BUYER);
    expect(built.validation.valid).toBe(true); // sanity: this IS a real, EN 16931-valid CII document
    const xml = Buffer.from(built.bytes).toString('utf-8');

    const result = await extractReceivedInvoiceFields(
      new TextEncoder().encode(xml),
      'application/xml',
      'invoice.xml',
    );

    expect(result.syntax).toBe('CII');
    expect(result.fields).toEqual({
      supplierNumber: 'INV-2026-0001',
      issueDate: '2026-08-30',
      supplier: 'Dupont Consulting SARL',
      // SELLER's own `partyIdentifiers` VAT entry, round-tripped through
      // `SellerTradeParty/SpecifiedTaxRegistration/ID` (see extraction.ts's own header).
      supplierVatId: 'FR12345678901',
      currency: 'EUR',
      netAmount: 13600,
      vatAmount: 2720,
      grossAmount: 16320,
      lines: EXPECTED_LINES,
    });
  });

  it('UBL: every field extracted matches the hand-computed fixture exactly', async () => {
    const built = await ublFormatProvider.build(descriptor, DOCUMENT, SELLER, BUYER);
    expect(built.validation.valid).toBe(true);
    const xml = Buffer.from(built.bytes).toString('utf-8');

    const result = await extractReceivedInvoiceFields(
      new TextEncoder().encode(xml),
      'application/xml',
      'invoice.xml',
    );

    expect(result.syntax).toBe('UBL');
    expect(result.fields).toEqual({
      supplierNumber: 'INV-2026-0001',
      issueDate: '2026-08-30',
      supplier: 'Dupont Consulting SARL',
      // Same SELLER identifier, this time round-tripped through
      // `AccountingSupplierParty/.../PartyTaxScheme/CompanyID` (see extraction.ts's own header on why
      // this is scoped to THAT block, never `PartyLegalEntity`'s own, sibling `CompanyID`).
      supplierVatId: 'FR12345678901',
      currency: 'EUR',
      netAmount: 13600,
      vatAmount: 2720,
      grossAmount: 16320,
      lines: EXPECTED_LINES,
    });
  });

  it('mime/dialect detection also works from a .xml filename alone (no explicit XML mime)', async () => {
    const built = await ciiFormatProvider.build(descriptor, DOCUMENT, SELLER, BUYER);
    const xml = Buffer.from(built.bytes).toString('utf-8');

    const result = await extractReceivedInvoiceFields(
      new TextEncoder().encode(xml),
      'application/octet-stream',
      'supplier-invoice.xml',
    );

    expect(result.syntax).toBe('CII');
    expect(result.fields.supplierNumber).toBe('INV-2026-0001');
  });

  describe('Factur-X — the embedded CII is found and extracted out of a real PDF/A-3', () => {
    async function fakeRealPdf(): Promise<Buffer> {
      const { PDFDocument } = require('pdf-lib');
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      return Buffer.from(await doc.save());
    }

    beforeEach(async () => {
      // Same mock shape `formats/facturx-provider.spec.ts` uses, for the identical reason: a REAL,
      // valid PDF built with `pdf-lib` (so `@e-invoice-eu/core`'s embedder genuinely has bytes to
      // attach to), while `rendering/render-instance-pdf.ts` (real Puppeteer) has no business here.
      (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
        pdf: await fakeRealPdf(),
        totals: {
          currency: 'EUR',
          lines: [],
          netMinor: 0,
          vatMinor: 0,
          grossMinor: 0,
          vatBreakdown: [],
          warnings: [],
        },
        referenceLabels: {},
        companyName: SELLER.name,
      });
    });

    // Budget, not an assertion. This is the heaviest single test in the suite: it builds a real
    // PDF/A-3, embeds the CII, runs the full vendored EN 16931 Schematron over it, and only then
    // parses the result back out -- the same build-and-validate work every sibling format spec
    // budgets 30_000ms for, plus the extraction on top.
    //
    // It cleared 20_000 and then 30_000 on CI anyway, and the reason was not this test: the whole
    // backend suite runs 4.5x slower there (458s against 102s locally) because jest's own
    // `maxWorkers: 4` -- a figure that suits a developer machine -- has four workers contending for
    // a runner's far smaller core count. The CI job now caps workers at 2, which alone brings this
    // under 30s in a two-core simulation here. 60_000 is the margin on top, so a slower runner on a
    // bad day does not turn a passing test red again.
    it('extracts the embedded CII, with every field matching the same fixture', async () => {
      const provider = buildFacturxFormatProvider({ referenceRegistry: new EntityReferenceRegistry() });
      const built = await provider.build(descriptor, DOCUMENT, SELLER, BUYER, 'company-1');
      expect(built.validation.valid).toBe(true);

      const result = await extractReceivedInvoiceFields(built.bytes, 'application/pdf', 'invoice.pdf');

      expect(result.syntax).toBe('FACTURX_CII');
      expect(result.fields).toEqual({
        supplierNumber: 'INV-2026-0001',
        issueDate: '2026-08-30',
        supplier: 'Dupont Consulting SARL',
        supplierVatId: 'FR12345678901', // Factur-X is the SAME CII — see the CII test above.
        currency: 'EUR',
        netAmount: 13600,
        vatAmount: 2720,
        grossAmount: 16320,
        lines: EXPECTED_LINES,
      });
    }, 60_000);
  });

  describe('a plain PDF with no embedded XML — never a refusal, just nothing to pre-fill', () => {
    it('yields an empty extraction (syntax null, every field undefined) for a real, attachment-less PDF', async () => {
      const { PDFDocument } = require('pdf-lib');
      const plain = await PDFDocument.create();
      plain.addPage([200, 200]);
      const bytes = await plain.save();

      const result = await extractReceivedInvoiceFields(bytes, 'application/pdf', 'scanned-invoice.pdf');

      expect(result).toEqual({ syntax: null, fields: {} });
    });

    it('yields an empty extraction (never throws) for bytes that are not even a parseable PDF at all', async () => {
      const bytes = new TextEncoder().encode('this is not a PDF');
      const result = await extractReceivedInvoiceFields(bytes, 'application/pdf', 'not-really-a-pdf.pdf');
      expect(result).toEqual({ syntax: null, fields: {} });
    });
  });

  it('an unrecognized XML dialect degrades to an empty extraction rather than throwing', async () => {
    const xml = '<?xml version="1.0"?><SomethingElseEntirely><Foo>bar</Foo></SomethingElseEntirely>';
    const result = await extractReceivedInvoiceFields(
      new TextEncoder().encode(xml),
      'application/xml',
      'x.xml',
    );
    expect(result).toEqual({ syntax: null, fields: {} });
  });

  it('an unrecognized mime/extension altogether degrades to an empty extraction', async () => {
    const result = await extractReceivedInvoiceFields(
      new TextEncoder().encode('hello'),
      'application/octet-stream',
      'notes.txt',
    );
    expect(result).toEqual({ syntax: null, fields: {} });
  });

  describe('entity decoding and adversarial input — never a literal entity, never a stall', () => {
    // Hand-written on purpose, unlike the rest of this file's own "never a hand-written fixture"
    // rule (see this file's own header): these three tests prove a MECHANICAL parser property
    // (entity decoding, resilience to a pathological shape, the size bound) rather than a
    // field-mapping fact about what our own providers emit — the same reasoning
    // `received-invoices.service.spec.ts`'s own hand-written `MINIMAL_CII_XML` fixture already relies on.
    const CII_WITH_ENTITIES = `<?xml version="1.0" encoding="utf-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Boulangerie Caf&#233; &amp; Fils</ram:Name></ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

    it('decodes the predefined entity (&amp;) and a numeric character reference (&#233;) — never left literal', async () => {
      const result = await extractReceivedInvoiceFields(
        new TextEncoder().encode(CII_WITH_ENTITIES),
        'application/xml',
        'supplier.xml',
      );

      expect(result.syntax).toBe('CII');
      // Never `Boulangerie Caf&#233; &amp; Fils` — the literal, un-decoded text the old regex-based
      // reader used to hand `supplier-reconciliation.ts`, which could then never match it against a
      // Client's own, properly-decoded `name`.
      expect(result.fields.supplier).toBe('Boulangerie Café & Fils');
    });

    it('a deposit rich in never-closed opening tags is rejected fast — no catastrophic backtracking', async () => {
      const bomb =
        '<?xml version="1.0"?><rsm:CrossIndustryInvoice ' +
        'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
        'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">' +
        '<ram:IncludedSupplyChainTradeLineItem>'.repeat(20_000); // deliberately never closed
      const bytes = new TextEncoder().encode(bomb);

      const start = performance.now();
      const result = await extractReceivedInvoiceFields(bytes, 'application/xml', 'bomb.xml');
      const elapsedMs = performance.now() - start;

      // The old regex-based `extractAllBlocks` re-scanned the remaining document from every one of
      // these 20 000 opening tags looking for a close tag that never comes — quadratic over the byte
      // count. A real parser fails fast on the same input instead of stalling the event loop.
      expect(elapsedMs).toBeLessThan(100);
      // Malformed (never actually closed) — an honest empty extraction, never a thrown error.
      expect(result).toEqual({ syntax: null, fields: {} });
    });

    it('never resolves an external entity (XXE) — the file it points at is never read', async () => {
      const xxe = `<?xml version="1.0"?>
<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/hostname">]>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">
  <rsm:SupplyChainTradeTransaction>
    <SellerTradeParty><Name>&xxe;</Name></SellerTradeParty>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

      const result = await extractReceivedInvoiceFields(
        new TextEncoder().encode(xxe),
        'application/xml',
        'xxe.xml',
      );

      // `@xmldom/xmldom` never fetches a SYSTEM/PUBLIC entity at all (see this file's own header) —
      // it reports the reference as a plain parse error instead, which `parseXmlDocument` treats as
      // malformed. The point of this test is not the exact outcome shape, it is what must NEVER
      // appear anywhere in it: the target file's own content, or the unresolved entity being silently
      // dropped and leaving a false empty string that could be mistaken for "no supplier name at all".
      expect(JSON.stringify(result)).not.toMatch(/root:|nobody|localhost/); // typical /etc/hostname content
      expect(result).toEqual({ syntax: null, fields: {} });
    });

    it('a billion-laughs entity blowup is refused fast, never expanded', async () => {
      const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">
  <rsm:SupplyChainTradeTransaction>
    <SellerTradeParty><Name>&lol4;</Name></SellerTradeParty>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

      const start = performance.now();
      const result = await extractReceivedInvoiceFields(
        new TextEncoder().encode(billionLaughs),
        'application/xml',
        'lol.xml',
      );
      const elapsedMs = performance.now() - start;

      // Same underlying reason as the XXE test above: `@xmldom/xmldom` does not expand ANY custom
      // entity (predefined + numeric references only — see this file's own header), so a
      // exponentially-nested one never actually multiplies out in memory; it is reported as an
      // "entity not found" parse error instead, same as any other malformed document.
      expect(elapsedMs).toBeLessThan(100);
      expect(result).toEqual({ syntax: null, fields: {} });
    });

    it('a deposit far over the size bound is refused before it reaches the parser at all', async () => {
      const oversized =
        '<?xml version="1.0"?><rsm:CrossIndustryInvoice ' +
        'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">' +
        'a'.repeat(6 * 1024 * 1024) +
        '</rsm:CrossIndustryInvoice>';
      const bytes = new TextEncoder().encode(oversized);

      const start = performance.now();
      const result = await extractReceivedInvoiceFields(bytes, 'application/xml', 'huge.xml');
      const elapsedMs = performance.now() - start;

      expect(elapsedMs).toBeLessThan(100);
      expect(result).toEqual({ syntax: null, fields: {} });
    });
  });
});
