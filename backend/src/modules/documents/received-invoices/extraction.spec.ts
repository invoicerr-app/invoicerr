/**
 * Received-invoice extraction's OWN master proof: every extraction path runs against XML/PDF our OWN outbound
 * providers (`cii-provider.ts`/`ubl-provider.ts`/`facturx-provider.ts`) actually produce — never a
 * hand-written XML fixture, and never `@e-invoice-eu/core`'s `fromXml` (the documented CII round-trip
 * bug this module's own header explains avoiding). The exact fixture (seller/buyer/lines) and its
 * hand-computed totals are copied verbatim from `formats/providers.spec.ts` ("Hand-computed") so the
 * expected numbers here are independently traceable to the same arithmetic that
 * file already proves against the REAL vendored EN 16931 Schematron.
 */
import { vi, type Mock } from 'vitest';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ciiFormatProvider } from '../formats/cii-provider';
import { buildFacturxFormatProvider } from '../formats/facturx-provider';
import { DocumentFormatParty } from '../formats/format-provider';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { ublFormatProvider } from '../formats/ubl-provider';
import { extractReceivedInvoiceFields } from './extraction';

vi.mock('../rendering/render-instance-pdf');

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
  // The three tests below build a real CII/UBL artifact through the REAL vendored EN 16931
  // Schematron (this file's own header) before ever getting to extraction — the same per-call cost
  // `formats/providers.spec.ts`'s sibling tests already budget 30_000ms for (the heavier Factur-X
  // round-trip further down already carries its own, larger 60_000 budget with its own measurement
  // comment). Measured directly: on an otherwise-idle box the CII-backed ones run 3.5s-3.8s; pinned
  // to 2 cores with `--maxWorkers=2` (this repo's own CI figure) that measurably clears 5000ms — the
  // 2026-09 CI timeout this budget exists to fix. 30_000 restores the headroom the rest of this test
  // family already has; this file simply never got it for these three when it was written.
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
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

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
      (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({
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

    // A fixed absolute-ms budget on wall-clock time is a flaky proxy for "not quadratic": a shared CI
    // runner measured 170ms on a fixture that runs in ~29ms locally (same code, same input) — noise
    // from the box, not a regression. What we actually want to assert never changes with the runner's
    // speed: growing the ADVERSARIAL input by `factor` should grow the time by roughly `factor` (linear
    // scan cost), never by roughly `factor²` (the old regex's own re-scan-from-every-open-tag
    // behaviour). So every test below times the SAME operation at two input sizes and checks the RATIO
    // instead of either raw number. `factor * 3` is deliberately generous — linear work lands near
    // `factor`×, real quadratic work lands near `factor²`× (16× at factor=4), so 12× catches the
    // regression with slack to spare for scheduler jitter — and `absoluteCapMs` stays only as a filet
    // against a genuinely hung process, wide enough to never fire from ordinary CI slowness.
    function assertGrowthAtMostLinear(elapsedSmall: number, elapsedLarge: number, factor: number) {
      const absoluteCapMs = 2000;
      expect(elapsedLarge).toBeLessThan(absoluteCapMs);
      // Floors the denominator so timer-resolution noise (sub-millisecond runs) can't inflate the ratio.
      const ratio = elapsedLarge / Math.max(elapsedSmall, 1);
      expect(ratio).toBeLessThan(factor * 3);
    }

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
      const buildBomb = (openTagCount: number) =>
        '<?xml version="1.0"?><rsm:CrossIndustryInvoice ' +
        'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
        'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">' +
        '<ram:IncludedSupplyChainTradeLineItem>'.repeat(openTagCount); // deliberately never closed

      const SMALL = 5_000;
      const LARGE = SMALL * 4;

      const start1 = performance.now();
      const result1 = await extractReceivedInvoiceFields(
        new TextEncoder().encode(buildBomb(SMALL)),
        'application/xml',
        'bomb.xml',
      );
      const elapsedSmall = performance.now() - start1;

      const start2 = performance.now();
      const result2 = await extractReceivedInvoiceFields(
        new TextEncoder().encode(buildBomb(LARGE)),
        'application/xml',
        'bomb.xml',
      );
      const elapsedLarge = performance.now() - start2;

      // The old regex-based `extractAllBlocks` re-scanned the remaining document from every one of
      // these opening tags looking for a close tag that never comes — quadratic over the byte count.
      // A real parser fails fast on the same input instead of stalling the event loop; see this
      // describe block's own comment for why growth (not a raw ms figure) is what gets asserted.
      assertGrowthAtMostLinear(elapsedSmall, elapsedLarge, 4);
      // Malformed (never actually closed) — an honest empty extraction, never a thrown error.
      expect(result1).toEqual({ syntax: null, fields: {} });
      expect(result2).toEqual({ syntax: null, fields: {} });
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
      // Each level fans out ×10 off the previous one — level 4 alone is already `lol` × 1 000; a real
      // parser expansion would blow that up to `lol` × 10⁸ by level 9. Building both from one generator
      // and comparing their elapsed time (rather than asserting either against a raw ms figure) is what
      // actually proves "never expanded": a real expansion would turn this 10⁵× jump in the entity
      // count into a comparably enormous jump in wall time, while "reported as a parse error and never
      // touched again" — the actual behaviour — costs about the same either way, whatever a shared
      // runner's own absolute speed happens to be that day.
      const buildBillionLaughs = (levels: number) => {
        const decls = ['<!ENTITY lol "lol">'];
        for (let level = 2; level <= levels; level++) {
          const prevRef = `&${level === 2 ? 'lol' : `lol${level - 1}`};`;
          decls.push(`<!ENTITY lol${level} "${prevRef.repeat(10)}">`);
        }
        return `<?xml version="1.0"?>
<!DOCTYPE lolz [
${decls.join('\n')}
]>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">
  <rsm:SupplyChainTradeTransaction>
    <SellerTradeParty><Name>&lol${levels};</Name></SellerTradeParty>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
      };

      const start1 = performance.now();
      const resultSmall = await extractReceivedInvoiceFields(
        new TextEncoder().encode(buildBillionLaughs(4)),
        'application/xml',
        'lol.xml',
      );
      const elapsedSmall = performance.now() - start1;

      const start2 = performance.now();
      const resultLarge = await extractReceivedInvoiceFields(
        new TextEncoder().encode(buildBillionLaughs(9)),
        'application/xml',
        'lol.xml',
      );
      const elapsedLarge = performance.now() - start2;

      // Same underlying reason as the XXE test above: `@xmldom/xmldom` does not expand ANY custom
      // entity (predefined + numeric references only — see this file's own header), so an
      // exponentially-nested one never actually multiplies out in memory; it is reported as an
      // "entity not found" parse error instead, same as any other malformed document. `factor: 1` below
      // asserts near-flat growth — anything but flat here would mean expansion is actually happening.
      assertGrowthAtMostLinear(elapsedSmall, elapsedLarge, 1);
      expect(resultSmall).toEqual({ syntax: null, fields: {} });
      expect(resultLarge).toEqual({ syntax: null, fields: {} });
    });

    it('a deposit far over the size bound is refused before it reaches the parser at all', async () => {
      const buildOversized = (megabytes: number) =>
        '<?xml version="1.0"?><rsm:CrossIndustryInvoice ' +
        'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">' +
        'a'.repeat(megabytes * 1024 * 1024) +
        '</rsm:CrossIndustryInvoice>';

      const start1 = performance.now();
      const resultSmall = await extractReceivedInvoiceFields(
        new TextEncoder().encode(buildOversized(6)),
        'application/xml',
        'huge.xml',
      );
      const elapsedSmall = performance.now() - start1;

      const start2 = performance.now();
      const resultLarge = await extractReceivedInvoiceFields(
        new TextEncoder().encode(buildOversized(24)),
        'application/xml',
        'huge.xml',
      );
      const elapsedLarge = performance.now() - start2;

      // Both are already over `MAX_XML_INPUT_BYTES` (5MB) — quadrupling the deposit's own size must
      // NOT quadruple the rejection cost, which is exactly what "refused before it reaches the parser"
      // means: only the (linear) byte-length check runs, never the DOM parse a genuine document this
      // size would otherwise cost.
      assertGrowthAtMostLinear(elapsedSmall, elapsedLarge, 4);
      expect(resultSmall).toEqual({ syntax: null, fields: {} });
      expect(resultLarge).toEqual({ syntax: null, fields: {} });
    });
  });
});
