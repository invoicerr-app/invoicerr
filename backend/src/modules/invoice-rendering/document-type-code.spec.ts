/**
 * BT-3 — the code, and the document it actually produces.
 *
 * The unit half is trivial; the half that matters renders through `@fin.cx/einvoice` and asserts the
 * ROOT ELEMENT as well as the code. UBL puts a credit note on its own root and admits 381 only there
 * (repo Schematron `EN16931-UBL-validation-preprocessed.sch`, BR-CL-01), while CII keeps one root for
 * everything. The library resolves that for us today — which is a fact about the library, not the
 * standard, so it is asserted rather than trusted.
 */
import { InvoiceRenderingService } from './invoice-rendering.service';
import { DOCUMENT_TYPE_CODE, documentTypeCode } from './document-type-code';

describe('documentTypeCode', () => {
  it('maps each kind this product issues', () => {
    expect(documentTypeCode('INVOICE')).toBe('380');
    expect(documentTypeCode('CREDIT_NOTE')).toBe('381');
    expect(documentTypeCode('DEBIT_NOTE')).toBe('383');
    expect(documentTypeCode('CORRECTIVE_INVOICE')).toBe('384');
    expect(documentTypeCode('DEPOSIT')).toBe('386');
    expect(documentTypeCode('FINAL')).toBe('380');
  });

  it('falls back to 380 for an absent or unknown kind — the behaviour every caller had before', () => {
    // The whole renderer used the literal '380'. Adding the field must not change what a path that
    // does not set it produces.
    expect(documentTypeCode(undefined)).toBe(DOCUMENT_TYPE_CODE.INVOICE);
    expect(documentTypeCode(null)).toBe('380');
    expect(documentTypeCode('SOMETHING_ELSE')).toBe('380');
  });
});

describe('the document that comes out', () => {
  const data = (kind: string) =>
    ({
      kind,
      rawNumber: 'X-1',
      number: 1,
      issuedAt: new Date('2026-09-02'),
      createdAt: new Date('2026-09-02'),
      paymentMethod: 'BANK_TRANSFER',
      paymentDetails: 'FR7630006000011234567890189',
      company: {
        name: 'Seller',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '1 rue A',
        city: 'Millau',
        postalCode: '12100',
        country: 'France',
        email: 'seller@example.test',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR18000000002' }],
      },
      client: {
        type: 'COMPANY',
        name: 'Buyer',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: '2 rue B',
        city: 'Tours',
        postalCode: '37170',
        country: 'France',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR15000000001' }],
      },
      items: [
        { name: 'Prestation', quantity: 1, unitPrice: 100, vatRate: 20, vatCategory: 'S', type: 'SERVICE' },
      ],
    }) as never;

  const rootOf = (xml: string) =>
    (xml.match(/<(?:\w+:)?(CrossIndustryInvoice|Invoice|CreditNote)[ >]/) ?? [])[1];
  const codeOf = (xml: string) => (xml.match(/TypeCode[^>]*>([^<]+)</) ?? [])[1];

  it('a credit note is a CreditNote in UBL and a 381 CrossIndustryInvoice in CII', async () => {
    const built = new InvoiceRenderingService().buildEInvoice(data('CREDIT_NOTE'));
    const ubl = await built.exportXml('ubl');
    const cii = await built.exportXml('cii');

    expect(rootOf(ubl)).toBe('CreditNote');
    expect(codeOf(ubl)).toBe('381');
    expect(rootOf(cii)).toBe('CrossIndustryInvoice');
    expect(codeOf(cii)).toBe('381');
  }, 60000);

  it('everything else stays an Invoice, with its own code', async () => {
    for (const [kind, code] of [
      ['INVOICE', '380'],
      ['DEBIT_NOTE', '383'],
      ['CORRECTIVE_INVOICE', '384'],
      ['DEPOSIT', '386'],
    ] as const) {
      const built = new InvoiceRenderingService().buildEInvoice(data(kind));
      const ubl = await built.exportXml('ubl');
      expect(`${kind}: ${rootOf(ubl)}/${codeOf(ubl)}`).toBe(`${kind}: Invoice/${code}`);
    }
  }, 120000);
});
