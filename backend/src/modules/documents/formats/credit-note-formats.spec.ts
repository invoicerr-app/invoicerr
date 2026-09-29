/**
 * Issue #472 - a credit note through every electronic format the invoice path already produces,
 * judged by the SAME gates: the vendored EN 16931 Schematron (CII and UBL), the Peppol BIS and KoSIT
 * XRechnung deltas on top of it, and the Agenzia delle Entrate FatturaPA XSD. No gate is mocked; a
 * failing assertion prints every rule that fired. The fixtures reuse the parties and line shapes the
 * invoice-side master proofs (`providers.spec.ts`, `peppol-bis-provider.spec.ts`,
 * `xrechnung-provider.spec.ts`, `national/fatturapa-provider.spec.ts`) already validate, so a failure
 * here is a credit-note failure, not a fixture one.
 *
 * What a credit-note build receives is what `credit-note-source.ts` hands it: the INVOICE descriptor
 * and invoice-shaped data (the corrected lines), plus `options.creditNote` - so that is exactly what
 * these tests pass.
 */
import { vi, type Mock } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { ciiFormatProvider } from './cii-provider';
import { buildFacturxFormatProvider } from './facturx-provider';
import { DocumentFormatBuildOptions, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { fa3FormatProvider } from './national/fa3-provider';
import { fatturapaFormatProvider } from './national/fatturapa-provider';
import { peppolBisFormatProvider } from './peppol-bis-provider';
import { SemanticBuildError } from './semantic/build-semantic-invoice';
import { ublFormatProvider } from './ubl-provider';
import { validateXsd } from './vendored/validate-xsd';
import { xrechnungFormatProvider } from './xrechnung-provider';
import { resolveNumberFormatFor } from '../numbering/company-number-format';
import { formatDocumentNumber } from '../numbering/format-number';

vi.mock('../rendering/render-instance-pdf');

const invoiceDescriptor = buildInvoiceDescriptor();
const creditNoteDescriptor = buildCreditNoteDescriptor();

const CREDIT_NOTE: DocumentFormatBuildOptions = {
  creditNote: { correctedInvoice: { displayNumber: 'INVOICE-2026-0007', issueDate: '2026-08-30' } },
};

/** French seller, German buyer - `providers.spec.ts`'s own master-proof parties. */
const FR_SELLER: DocumentFormatParty = {
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
const DE_BUYER: DocumentFormatParty = {
  name: 'Acme GmbH',
  address: 'Friedrichstraße 42',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

/** One corrected line: 2 × 800.00 at 20% - net 1600.00, VAT 320.00, gross 1920.00. */
const FR_DATA = {
  client: 'client-1',
  issueDate: '2026-09-20',
  currency: 'EUR',
  notes: 'Avoir sur la formation annulée.',
  lines: [{ description: 'Formation équipe', quantity: 2, unit: 'day', unitPrice: 800, vatRate: '20' }],
};

/** `peppol-bis-provider.spec.ts`'s own parties: German seller, French buyer, BT-10 set (R003). */
const DE_SELLER: DocumentFormatParty = {
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  email: 'contact@muster.example',
  phone: '+49301234567',
  iban: 'DE89370400440532013000',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};
const FR_BUYER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
};
const DE_PUBLIC_BUYER: DocumentFormatParty = {
  name: 'Stadt Musterstadt',
  address: 'Rathausplatz 1',
  city: 'Musterstadt',
  postalCode: '12345',
  country: 'Germany',
  partyIdentifiers: [],
};
/** One corrected line: 5 × 200.00 at 19% - net 1000.00, VAT 190.00, gross 1190.00. */
const DE_DATA = {
  client: 'client-1',
  issueDate: '2026-09-20',
  currency: 'EUR',
  buyerReference: '04011000-1234512345-06',
  lines: [{ description: 'Beratungsleistung', quantity: 5, unit: 'hour', unitPrice: 200, vatRate: '19' }],
};

/** `national/fatturapa-provider.spec.ts`'s own parties, domestic Italy. */
const IT_SELLER: DocumentFormatParty = {
  name: 'Rossi SRL',
  address: 'Via Roma 10',
  city: 'Milano',
  postalCode: '20100',
  country: 'Italy',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'IT12345678901' },
    { scheme: 'LEGAL_ID', value: 'MI1234567' },
  ],
};
const IT_BUYER: DocumentFormatParty = {
  name: 'Bianchi SpA',
  address: 'Corso Italia 20',
  city: 'Roma',
  postalCode: '00100',
  country: 'Italy',
  partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
};
/** Two corrected lines, the second discounted (the invoice descriptor's own `discountPercent` is what
 *  prices it - the reason `credit-note-source.ts` builds with that descriptor):
 *  1 × 1000.00 @ 22% = 1000.00 (VAT 220.00) ; 2 × 50.00 @ 10% - 20% = 80.00 (VAT 8.00) ; gross 1308.00. */
const IT_DATA = {
  client: 'client-1',
  issueDate: '2026-09-20',
  currency: 'EUR',
  lines: [
    { description: 'Consulenza strategica', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '22' },
    {
      description: 'Assistenza tecnica',
      quantity: 2,
      unit: 'ora',
      unitPrice: 50,
      vatRate: '10',
      discountPercent: 20,
    },
  ],
};

function doc(data: unknown, displayNumber: string | null = 'CREDIT-NOTE-2026-0001') {
  return { id: 'cn-1', data, displayNumber, status: 'sent', createdAt: new Date('2026-09-20T10:00:00Z') };
}

async function xmlOf(
  provider: DocumentFormatProvider,
  data: unknown,
  seller: DocumentFormatParty,
  buyer: DocumentFormatParty,
  displayNumber = 'CREDIT-NOTE-2026-0001',
) {
  const result = await provider.build(
    invoiceDescriptor,
    doc(data, displayNumber),
    seller,
    buyer,
    'company-1',
    CREDIT_NOTE,
  );
  return { result, xml: Buffer.from(result.bytes).toString('utf-8') };
}

describe('issue #472 - a credit note in every EN 16931 syntax, judged by the same Schematron gates', () => {
  it('UBL: a genuine <CreditNote> (381) referencing the corrected invoice (BG-3), 0 EN 16931 error', async () => {
    const { result, xml } = await xmlOf(ublFormatProvider, FR_DATA, FR_SELLER, DE_BUYER);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(xml).toMatch(/<CreditNote[ >]/);
    expect(xml).not.toMatch(/<Invoice[ >]/);
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toMatch(
      /<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>INVOICE-2026-0007<\/cbc:ID>\s*<cbc:IssueDate>2026-08-30<\/cbc:IssueDate>/,
    );
    expect(xml).toContain('<cbc:ID>CREDIT-NOTE-2026-0001</cbc:ID>');
    expect(xml).toMatch(/<cac:CreditNoteLine>/);
    expect(xml).toMatch(/<cbc:CreditedQuantity unitCode="DAY">2<\/cbc:CreditedQuantity>/);
    // Positive amounts - the type code, not the sign, makes it a credit note.
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">1920.00</cbc:PayableAmount>');
  }, 30_000);

  it('CII: TypeCode 381 and the corrected invoice as InvoiceReferencedDocument, 0 EN 16931 error', async () => {
    const { result, xml } = await xmlOf(ciiFormatProvider, FR_DATA, FR_SELLER, DE_BUYER);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(xml).toMatch(
      /<rsm:ExchangedDocument>\s*<ram:ID>CREDIT-NOTE-2026-0001<\/ram:ID>\s*<ram:TypeCode>381<\/ram:TypeCode>/,
    );
    expect(xml).toMatch(
      /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>INVOICE-2026-0007<\/ram:IssuerAssignedID>\s*<ram:FormattedIssueDateTime>\s*<qdt:DateTimeString format="102">20260830<\/qdt:DateTimeString>/,
    );
    expect(xml).toContain('<ram:GrandTotalAmount>1920.00</ram:GrandTotalAmount>');
  }, 30_000);

  it('Peppol BIS Billing 3.0: a <CreditNote> both the EN 16931 base and the OpenPeppol delta accept', async () => {
    const { result, xml } = await xmlOf(peppolBisFormatProvider, DE_DATA, DE_SELLER, FR_BUYER);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(xml).toMatch(/<CreditNote[ >]/);
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cbc:ID>INVOICE-2026-0007</cbc:ID>');
  }, 30_000);

  it('XRechnung 3.0: a <CreditNote> both the EN 16931 base and the KoSIT delta accept (381 is in BR-DE-17)', async () => {
    const { result, xml } = await xmlOf(xrechnungFormatProvider, DE_DATA, DE_SELLER, DE_PUBLIC_BUYER);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(xml).toMatch(/<CreditNote[ >]/);
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cbc:ID>INVOICE-2026-0007</cbc:ID>');
  }, 30_000);

  it('Factur-X: embeds a CII 381 that passes the gate, and renders the PDF of the CREDIT NOTE as issued', async () => {
    const hostPdf = await PDFDocument.create();
    hostPdf.addPage([595, 842]);
    const pdfBytes = Buffer.from(await hostPdf.save());
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({ pdf: pdfBytes });

    const provider = buildFacturxFormatProvider({ referenceRegistry: new EntityReferenceRegistry() });
    const creditNoteAsIssued = {
      ...doc({
        invoice: 'inv-1',
        correctedLines: ['row-1'],
        issueDate: '2026-09-20',
        currency: 'EUR',
        lines: [],
      }),
      number: 1,
      typeId: 'credit-note',
    } as unknown as NonNullable<DocumentFormatBuildOptions['humanReadable']>['document'];
    const result = await provider.build(invoiceDescriptor, doc(FR_DATA), FR_SELLER, DE_BUYER, 'company-1', {
      ...CREDIT_NOTE,
      humanReadable: { descriptor: creditNoteDescriptor, document: creditNoteAsIssued },
    });

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(Buffer.from(result.bytes.slice(0, 5)).toString()).toBe('%PDF-');
    // The human-readable page is the credit note's own, never an "Invoice" rendering of its lines.
    const call = (renderInstancePdf.renderDocumentInstance as Mock).mock.calls.at(-1);
    expect(call?.[2]?.id).toBe('credit-note');
    expect(call?.[3]).toBe(creditNoteAsIssued);
    // Issue #494: the credit note's own page is rendered as the delivered legal copy, so it prints no
    // status line (`rendering/status-line-policy.ts`).
    expect(call?.[4]).toBe('delivery');
  }, 30_000);
});

describe('issue #472 - FatturaPA TD04 (nota di credito), judged by the real Agenzia delle Entrate XSD', () => {
  it("TD04 + DatiFattureCollegate naming the corrected invoice, no payment instruction, XSD-valid, with the number Italy's DEFAULT format produces (issue #496)", async () => {
    // Issue #496: the credit-note number is rendered through the format numbering itself resolves for
    // an Italian company with no running series (country-policy/data/it.json), at a six-digit counter -
    // never a hand-picked short literal, so this test breaks the day that format stops fitting.
    const resolved = resolveNumberFormatFor('IT', 'credit-note', null);
    expect(resolved.source).toBe('country-policy');
    const displayNumber = formatDocumentNumber(resolved.pattern, {
      number: 999_999,
      date: new Date(2026, 8, 20),
    });
    expect(displayNumber).toBe('CN-2026-999999');

    const { result, xml } = await xmlOf(fatturapaFormatProvider, IT_DATA, IT_SELLER, IT_BUYER, displayNumber);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    const flat = xml.replace(/>\s+</g, '><');
    expect(flat).toContain('<TipoDocumento>TD04</TipoDocumento>');
    expect(flat).toContain(
      '<DatiFattureCollegate><IdDocumento>INVOICE-2026-0007</IdDocumento><Data>2026-08-30</Data></DatiFattureCollegate>',
    );
    expect(flat).toContain(`<Numero>${displayNumber}</Numero>`);
    expect(flat).toContain('<ImportoTotaleDocumento>1308.00</ImportoTotaleDocumento>');
    expect(flat).not.toContain('<DatiPagamento>');

    // Re-validated here, independently of the provider's own verdict: the gate is the XSD, not the
    // provider's opinion of itself.
    const xsd = await validateXsd(xml, 'it/Schema_VFPR12.xsd');
    expect(xsd.errors).toEqual([]);
  }, 30_000);

  it('a number over 20 characters (the pre-#496 default, "CREDIT-NOTE-2026-0001") is still refused by the XSD, never truncated', async () => {
    // FatturaPA's `Numero` is `String20Type` (at most 20 Basic Latin characters, vendored XSD). The
    // legal number is never shortened to fit (it would no longer be the number the document was issued
    // with): the gate refuses, naming the element. Since issue #496 numbering never produces such a
    // number for an Italian company (the constraint it-fatturapa-numero-string20 is checked on every
    // number before it is issued), but a legacy document may still carry one.
    const { result } = await xmlOf(fatturapaFormatProvider, IT_DATA, IT_SELLER, IT_BUYER);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.join(' ')).toMatch(/Element 'Numero'.*CREDIT-NOTE-2026-0001/);
  }, 30_000);

  it('an invoice still gets TD01 and its DatiPagamento - the credit-note branch changes nothing for it', async () => {
    const result = await fatturapaFormatProvider.build(
      invoiceDescriptor,
      doc(IT_DATA, 'FT-2026-0001'),
      IT_SELLER,
      IT_BUYER,
    );
    const flat = Buffer.from(result.bytes).toString('utf-8').replace(/>\s+</g, '><');
    expect(result.validation.valid).toBe(true);
    expect(flat).toContain('<TipoDocumento>TD01</TipoDocumento>');
    expect(flat).toContain('<DatiPagamento>');
    expect(flat).not.toContain('<DatiFattureCollegate>');
  }, 30_000);
});

describe('issue #472 - what is refused rather than built', () => {
  it('FA(3) refuses a credit note: Polish law corrects with a KOR invoice, never a credit-note document', async () => {
    await expect(
      fa3FormatProvider.build(invoiceDescriptor, doc(FR_DATA), FR_SELLER, DE_BUYER, 'company-1', CREDIT_NOTE),
    ).rejects.toThrow(SemanticBuildError);
    await expect(
      fa3FormatProvider.build(invoiceDescriptor, doc(FR_DATA), FR_SELLER, DE_BUYER, 'company-1', CREDIT_NOTE),
    ).rejects.toThrow(/faktura korygująca/);
  });

  it.each([
    ['cii', ciiFormatProvider, FR_DATA, FR_SELLER, DE_BUYER],
    ['ubl', ublFormatProvider, FR_DATA, FR_SELLER, DE_BUYER],
    ['peppol-bis', peppolBisFormatProvider, DE_DATA, DE_SELLER, FR_BUYER],
    ['xrechnung', xrechnungFormatProvider, DE_DATA, DE_SELLER, DE_PUBLIC_BUYER],
    ['fatturapa', fatturapaFormatProvider, IT_DATA, IT_SELLER, IT_BUYER],
    ['fa3', fa3FormatProvider, FR_DATA, FR_SELLER, DE_BUYER],
  ] as const)('%s: a document with no number produces no file at all - never a "DRAFT" placeholder', async (_id, provider, data, seller, buyer) => {
    // An INVOICE build (no `options.creditNote`), so the only reason to refuse is the missing number.
    await expect(
      provider.build(invoiceDescriptor, doc(data, null), seller, buyer, 'company-1'),
    ).rejects.toThrow(/no legal number/);
  });
});
