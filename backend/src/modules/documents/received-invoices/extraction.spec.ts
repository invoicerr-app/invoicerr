/**
 * Root TODO item 18's OWN master proof: every extraction path runs against XML/PDF our OWN outbound
 * providers (`cii-provider.ts`/`ubl-provider.ts`/`facturx-provider.ts`) actually produce — never a
 * hand-written XML fixture, and never `@e-invoice-eu/core`'s `fromXml` (the documented CII round-trip
 * bug this module's own header explains avoiding). The exact fixture (seller/buyer/lines) and its
 * hand-computed totals are copied verbatim from `formats/providers.spec.ts` ("Hand-computed, chiffrée
 * à la main") so the expected numbers here are independently traceable to the same arithmetic that
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
 * Hand-computed, chiffrée à la main (copied from `formats/providers.spec.ts`):
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
      // TODO_PRODUIT.md T5(b) — SELLER's own `partyIdentifiers` VAT entry, round-tripped through
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
      // TODO_PRODUIT.md T5(b) — same SELLER identifier, this time round-tripped through
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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

    // Building a real PDF/A-3 + embedding + the real vendored EN 16931 Schematron is genuinely slow
    // under full-suite CPU contention (fast in isolation) — the explicit 20s budget below is the
    // same generous margin `formats/facturx-provider.spec.ts`'s own equivalent case relies on,
    // needed here too since this file runs a SECOND full build+validate pass on top of that one.
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
    }, 20000);
  });

  describe('a plain PDF with no embedded XML — never a refusal, just nothing to pre-fill', () => {
    it('yields an empty extraction (syntax null, every field undefined) for a real, attachment-less PDF', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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
});
