/**
 * Root TODO item 16 ("transfrontalier") — the END-TO-END proof the task's own brief demands: a real
 * CII export, built through the REAL pipeline (`resolveInvoiceCrossBorderTax` →
 * `computeDocumentTotals` → `formats/cii-provider.ts`), JUDGED by the real vendored EN 16931
 * Schematron (`formats/vendored/validate-schematron.ts`) — never a hand-asserted opinion of the XML.
 * Same harness `formats/providers.spec.ts` already established as "the master proof" for item 12.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ciiFormatProvider } from '../formats/cii-provider';
import { DocumentFormatParty } from '../formats/format-provider';
import { resolveInvoiceCrossBorderTax } from './resolve-invoice-tax';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const FR_SELLER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
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
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE136695976' }], // checksum-valid, see vat-syntax.spec.ts
};

const US_BUYER: DocumentFormatParty = {
  name: 'Acme US Inc.',
  address: '1 Main St',
  city: 'Wilmington',
  postalCode: '19801',
  country: 'United States',
  partyIdentifiers: [],
};

describe('root TODO item 16 — FR→DE B2B, valid VAT: reverse charge, judged by real EN 16931 Schematron', () => {
  it('the downloaded CII carries 0%, category AE, and the art. 196 mention in BG-1', async () => {
    const rawData = {
      client: 'client-1',
      issueDate: '2026-08-30',
      dueDate: '2026-09-30',
      currency: 'EUR',
      lines: [
        {
          description: 'Conseil stratégique',
          quantity: 10,
          unit: 'hour',
          unitPrice: 1200,
          vatRate: '20',
          supplyType: 'SERVICES',
        },
      ],
    };

    const resolved = resolveInvoiceCrossBorderTax({
      seller: { country: FR_SELLER.country },
      buyer: { country: DE_BUYER.country },
      buyerVat: { value: 'DE136695976', validationStatus: 'VALID' },
      data: rawData,
    });
    expect(resolved.crossBorder).toBe(true);

    const document = { id: 'doc-fr-de', data: resolved.data, displayNumber: 'INV-2026-0042', status: 'sent' };
    const result = await ciiFormatProvider.build(descriptor, document, FR_SELLER, DE_BUYER);

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);
    const xml = Buffer.from(result.bytes).toString('utf-8');

    // BT-152/BT-151 — 0% rate, AE category, on the line itself.
    expect(xml).toMatch(/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/);
    expect(xml).toMatch(/<ram:CategoryCode>AE<\/ram:CategoryCode>/);
    // BG-1 (BT-22) — the reverse-charge mention, verbatim from the repère.
    expect(xml).toContain('Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC');
    // Totals actually reflect the resolved 0% treatment, not the originally-typed 20%.
    expect(xml).toMatch(/<ram:TaxTotalAmount currencyID="EUR">0\.00<\/ram:TaxTotalAmount>/);
    expect(xml).toMatch(/<ram:GrandTotalAmount>12000\.00<\/ram:GrandTotalAmount>/);
  });
});

describe('root TODO item 16 — FR→US B2B export of goods: category G, judged by real EN 16931 Schematron', () => {
  it('the downloaded CII carries 0%, category G, and the art. 146 export mention', async () => {
    const rawData = {
      client: 'client-2',
      issueDate: '2026-08-30',
      dueDate: '2026-09-30',
      currency: 'EUR',
      lines: [
        {
          description: 'Hardware',
          quantity: 5,
          unit: 'unit',
          unitPrice: 200,
          vatRate: '20',
          supplyType: 'GOODS',
        },
      ],
    };

    const resolved = resolveInvoiceCrossBorderTax({
      seller: { country: FR_SELLER.country },
      buyer: { country: US_BUYER.country },
      data: rawData,
    });
    expect(resolved.crossBorder).toBe(true);

    const document = { id: 'doc-fr-us', data: resolved.data, displayNumber: 'INV-2026-0043', status: 'sent' };
    const result = await ciiFormatProvider.build(descriptor, document, FR_SELLER, US_BUYER);

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);
    const xml = Buffer.from(result.bytes).toString('utf-8');

    expect(xml).toMatch(/<ram:CategoryCode>G<\/ram:CategoryCode>/);
    expect(xml).toContain('Export — zero-rated, Art. 146 Directive 2006/112/EC');
    expect(xml).toMatch(/<ram:TaxTotalAmount currencyID="EUR">0\.00<\/ram:TaxTotalAmount>/);
    expect(xml).toMatch(/<ram:GrandTotalAmount>1000\.00<\/ram:GrandTotalAmount>/);
  });
});

describe('root TODO item 16 — a pure-domestic FR send is untouched by any of this', () => {
  it('a FR→FR invoice at 20% is byte-identical in intent to the pre-item-16 behaviour (category S)', async () => {
    const rawData = {
      client: 'client-3',
      issueDate: '2026-08-30',
      dueDate: '2026-09-30',
      currency: 'EUR',
      lines: [{ description: 'Conseil', quantity: 1, unit: 'day', unitPrice: 1000, vatRate: '20' }],
    };
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { country: FR_SELLER.country },
      buyer: { country: FR_SELLER.country },
      data: rawData,
    });
    expect(resolved.crossBorder).toBe(false);
    expect(resolved.data).toBe(rawData);

    const document = { id: 'doc-fr-fr', data: resolved.data, displayNumber: 'INV-2026-0044', status: 'sent' };
    const result = await ciiFormatProvider.build(descriptor, document, FR_SELLER, FR_SELLER);
    expect(result.validation.valid).toBe(true);
    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toMatch(/<ram:CategoryCode>S<\/ram:CategoryCode>/);
    expect(xml).toMatch(/<ram:RateApplicablePercent>20<\/ram:RateApplicablePercent>/);
  });
});
