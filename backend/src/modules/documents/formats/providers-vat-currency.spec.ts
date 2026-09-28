/**
 * Issue #517: BT-6 (VAT accounting currency code) and BT-111 (Invoice total VAT amount in
 * accounting currency), the SAME "master proof" discipline `providers.spec.ts` already holds for the
 * base fixture: a hand-computed fixture through the REAL build pipeline (descriptor,
 * `semantic/build-semantic-invoice.ts`, `@e-invoice-eu/core`'s own XML generator) and the REAL
 * vendored EN 16931 Schematron (`vendored/validate-schematron.ts`) as the judge, never this file's
 * own opinion of what "valid" means. A SEPARATE file from `providers.spec.ts` (never edited there)
 * so this feature's own fixtures never risk drifting that file's own pinned byte-for-byte assertions.
 *
 * `document.vatNationalCurrency`/`vatNationalCurrencyVatMinor` are exactly the two columns
 * `vat-currency-issuance.ts#attachVatNationalCurrencyToNumberedDocument` freezes onto a real
 * `DocumentInstance` at issuance, passed here directly on the fixture object (never re-derived) the
 * same way `providers.spec.ts`'s own `DOCUMENT` passes a plain `displayNumber`/`status`.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ciiFormatProvider } from './cii-provider';
import { DocumentFormatParty } from './format-provider';
import { ublFormatProvider } from './ubl-provider';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

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

const PL_SELLER: DocumentFormatParty = {
  name: 'Kowalski Consulting sp. z o.o.',
  address: 'ul. Marszałkowska 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'Poland',
  email: 'kontakt@kowalski-consulting.example',
  phone: '+48221234567',
  partyIdentifiers: [{ scheme: 'VAT', value: 'PL1234567890' }],
};

/** US buyer: keeps the invoice cross-border (export, 0% VAT is the common real case for a USD
 *  invoice at all) without pulling in an unrelated EU destination-country VAT question this file's
 *  own concern (BT-6/BT-111) has nothing to do with. */
const US_BUYER: DocumentFormatParty = {
  name: 'Acme US Inc.',
  address: '1 Main St',
  city: 'Wilmington',
  postalCode: '19801',
  country: 'United States',
  email: 'buyer@acme-us.example',
};

/**
 * Hand-computed: one line, 20% VAT (a domestic-rate line kept simple on purpose: this fixture's own
 * concern is BT-6/BT-111, never the cross-border VAT-category resolution `resolve-invoice-tax.ts`
 * already has its own master proof for).
 *   net = 1000.00 USD ; VAT (20%) = 200.00 USD ; gross = 1200.00 USD
 * Converted at a hand-picked rate of 0.85 (USD -> EUR) / 4.20 (USD -> PLN):
 *   FR: VAT in EUR = 200.00 * 0.85 = 170.00 EUR (17000 minor)
 *   PL: VAT in PLN = 200.00 * 4.20 = 840.00 PLN (84000 minor)
 */
const USD_INVOICE_DATA = {
  client: 'client-1',
  issueDate: '2026-09-25',
  dueDate: '2026-10-25',
  currency: 'USD',
  notes: 'Thank you for your business.',
  lines: [{ description: 'Consulting services', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '20' }],
};

const FR_USD_DOCUMENT = {
  id: 'doc-fr-usd',
  data: USD_INVOICE_DATA,
  displayNumber: 'INV-2026-0100',
  status: 'sent',
  vatNationalCurrency: 'EUR',
  vatNationalCurrencyVatMinor: 17_000,
};

const PL_USD_DOCUMENT = {
  id: 'doc-pl-usd',
  data: USD_INVOICE_DATA,
  displayNumber: 'FV-2026-0100',
  status: 'sent',
  vatNationalCurrency: 'PLN',
  vatNationalCurrencyVatMinor: 84_000,
};

describe.each([
  ['CII', ciiFormatProvider] as const,
  ['UBL', ublFormatProvider] as const,
])('%s: issue #517, BT-6/BT-111 on a foreign-currency invoice, REAL vendored Schematron', (label, provider) => {
  // BT-5/BT-6 are named `cbc:DocumentCurrencyCode`/`cbc:TaxCurrencyCode` in UBL but
  // `ram:InvoiceCurrencyCode`/`ram:TaxCurrencyCode` in CII (@e-invoice-eu/core's own per-syntax
  // mapping of the SAME semantic input this bridge builds, see `build-semantic-invoice.ts`'s own
  // header), read back with the element name each REAL rendered syntax actually uses, never a
  // syntax-blind guess.
  const documentCurrencyTag = label === 'CII' ? 'ram:InvoiceCurrencyCode' : 'cbc:DocumentCurrencyCode';
  const taxCurrencyTag = label === 'CII' ? 'ram:TaxCurrencyCode' : 'cbc:TaxCurrencyCode';

  it('FRANCE (USD invoice): the REAL Schematron accepts BT-6=EUR and BT-111=170.00', async () => {
    const result = await provider.build(descriptor, FR_USD_DOCUMENT, FR_SELLER, US_BUYER);

    // A failing assertion here prints EVERY BR-* rule the vendored Schematron actually fired, never
    // swallowed: this is a gate, not a report.
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    // BT-5 (invoice currency) stays USD, untouched.
    expect(xml).toContain(`<${documentCurrencyTag}>USD</${documentCurrencyTag}>`);
    // BT-6.
    expect(xml).toContain(`<${taxCurrencyTag}>EUR</${taxCurrencyTag}>`);
    // BT-111: the SECOND tax total, carrying only the converted amount (no per-rate breakdown, see
    // `build-semantic-invoice.ts`'s own header on why there is no EN 16931 field for a converted
    // TAXABLE amount).
    expect(xml).toContain('170.00');
  }, 30_000);

  it('POLAND (USD invoice): the REAL Schematron accepts BT-6=PLN and BT-111=840.00', async () => {
    const result = await provider.build(descriptor, PL_USD_DOCUMENT, PL_SELLER, US_BUYER);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toContain(`<${documentCurrencyTag}>USD</${documentCurrencyTag}>`);
    expect(xml).toContain(`<${taxCurrencyTag}>PLN</${taxCurrencyTag}>`);
    expect(xml).toContain('840.00');
  }, 30_000);

  it('a document with NO vatNationalCurrency (the ordinary case) never emits BT-6/a second TaxTotal: byte-for-byte the pre-existing single-TaxTotal output', async () => {
    const plainDocument = {
      ...FR_USD_DOCUMENT,
      vatNationalCurrency: undefined,
      vatNationalCurrencyVatMinor: undefined,
    };
    const result = await provider.build(descriptor, plainDocument, FR_SELLER, US_BUYER);

    expect(result.validation.errors).toEqual([]);
    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).not.toContain('TaxCurrencyCode');
  }, 30_000);
});
