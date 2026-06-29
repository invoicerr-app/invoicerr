/**
 * Payment means code derivation + AllowanceCharge (document-level discount) tests.
 *
 * Verifies:
 *   - UNCL4461 code mapping from payment method strings (mapPaymentMeansCode)
 *   - IBAN extraction from free-text details (extractIban)
 *   - buildEInvoice emits PaymentMeansCode + PayeeFinancialAccount for bank transfer + IBAN
 *   - buildEInvoice emits AllowanceCharge when discountRate > 0 (BR-27 / BG-20)
 *   - LegalMonetaryTotal.TaxExclusiveAmount equals net after discount
 */
import { InvoiceRenderingService, mapPaymentMeansCode, extractIban, extractMandateReference, InvoiceRenderData } from './invoice-rendering.service';

const NOW = new Date('2025-06-01T10:00:00Z');

function baseData(overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  return {
    rawNumber: 'INV-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Test GmbH',
      description: null,
      foundedAt: null,
      currency: 'EUR',
      address: 'Teststr. 1',
      city: 'Berlin',
      postalCode: '10115',
      country: 'Germany',
      email: 'test@test.de',
      partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
    },
    client: {
      type: 'COMPANY',
      name: 'Buyer GmbH',
      description: null,
      foundedAt: null,
      contactFirstname: null,
      contactLastname: null,
      contactEmail: 'buyer@buyer.de',
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Käuferstr. 2',
      city: 'Munich',
      postalCode: '80333',
      country: 'Germany',
      partyIdentifiers: [{ scheme: 'VAT', value: 'DE987654321' }],
    },
    items: [
      { name: 'Consulting', quantity: 10, unitPrice: 100, vatRate: 19, type: 'SERVICE' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mapPaymentMeansCode
// ---------------------------------------------------------------------------

describe('mapPaymentMeansCode', () => {
  it('maps BANK_TRANSFER to 58 (SEPA credit transfer)', () => {
    expect(mapPaymentMeansCode('BANK_TRANSFER')).toBe(58);
  });

  it('maps CHECK / CHEQUE to 20', () => {
    expect(mapPaymentMeansCode('CHECK')).toBe(20);
    expect(mapPaymentMeansCode('CHEQUE')).toBe(20);
  });

  it('maps CASH to 10', () => {
    expect(mapPaymentMeansCode('CASH')).toBe(10);
  });

  it('maps PAYPAL to 97 (clearing between partners / PSP)', () => {
    expect(mapPaymentMeansCode('PAYPAL')).toBe(97);
  });

  it('maps STRIPE to 97 (clearing between partners / PSP)', () => {
    expect(mapPaymentMeansCode('STRIPE')).toBe(97);
  });

  it('maps CARD to 48 (bank card — debit/credit card)', () => {
    expect(mapPaymentMeansCode('CARD')).toBe(48);
  });

  it('maps DIRECT_DEBIT to 59 (SEPA direct debit)', () => {
    expect(mapPaymentMeansCode('DIRECT_DEBIT')).toBe(59);
    expect(mapPaymentMeansCode('SEPA_DIRECT_DEBIT')).toBe(59);
  });

  it('defaults to 1 for unknown/null', () => {
    expect(mapPaymentMeansCode(null)).toBe(1);
    expect(mapPaymentMeansCode(undefined)).toBe(1);
    expect(mapPaymentMeansCode('OTHER')).toBe(1);
    expect(mapPaymentMeansCode('')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(mapPaymentMeansCode('bank_transfer')).toBe(58);
    expect(mapPaymentMeansCode('Cash')).toBe(10);
    expect(mapPaymentMeansCode('direct_debit')).toBe(59);
  });
});

// ---------------------------------------------------------------------------
// extractIban
// ---------------------------------------------------------------------------

describe('extractIban', () => {
  it('extracts a bare IBAN from free-text details', () => {
    expect(extractIban('DE89370400440532013000')).toBe('DE89370400440532013000');
  });

  it('extracts IBAN with spaces', () => {
    expect(extractIban('IBAN: DE89 3704 0044 0532 0130 00')).toBe('DE89370400440532013000');
  });

  it('extracts IBAN embedded in longer text', () => {
    expect(extractIban('Bank: Commerzbank, IBAN DE89370400440532013000, BIC COBADEFFXXX')).toBe('DE89370400440532013000');
  });

  it('returns undefined when no IBAN found', () => {
    expect(extractIban(null)).toBeUndefined();
    expect(extractIban('PayPal: me@example.com')).toBeUndefined();
    expect(extractIban('')).toBeUndefined();
  });

  it('extracts IBAN with different country codes', () => {
    expect(extractIban('FR7630006000011234567890189')).toBe('FR7630006000011234567890189');
    expect(extractIban('PL61109010140000071219812874')).toBe('PL61109010140000071219812874');
  });
});

// ---------------------------------------------------------------------------
// buildEInvoice — payment means
// ---------------------------------------------------------------------------

describe('buildEInvoice payment means', () => {
  const service = new InvoiceRenderingService();

  it('emits PaymentMeansCode 58 for BANK_TRANSFER', async () => {
    const inv = service.buildEInvoice(baseData({ paymentMethod: 'BANK_TRANSFER' }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>');
  });

  it('emits PaymentMeansCode 10 for CASH', async () => {
    const inv = service.buildEInvoice(baseData({ paymentMethod: 'CASH' }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>');
  });

  it('emits PaymentMeansCode 97 for PAYPAL', async () => {
    const inv = service.buildEInvoice(baseData({ paymentMethod: 'PAYPAL' }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>97</cbc:PaymentMeansCode>');
  });

  it('emits PaymentMeansCode 48 for CARD (debit/credit card)', async () => {
    const inv = service.buildEInvoice(baseData({ paymentMethod: 'CARD' }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>');
  });

  it('emits PaymentMeansCode 59 for DIRECT_DEBIT (SEPA direct debit)', async () => {
    const inv = service.buildEInvoice(baseData({ paymentMethod: 'DIRECT_DEBIT' }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>59</cbc:PaymentMeansCode>');
  });

  it('emits PaymentMandate with mandate reference for DIRECT_DEBIT', async () => {
    const inv = service.buildEInvoice(baseData({
      paymentMethod: 'DIRECT_DEBIT',
      paymentDetails: 'MANDATE: MNDT-2025-001',
    }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>59</cbc:PaymentMeansCode>');
    expect(xml).toContain('PaymentMandate');
    expect(xml).toContain('MNDT-2025-001');
  });

  it('does NOT emit PaymentMandate when no mandate reference present', async () => {
    const inv = service.buildEInvoice(baseData({ paymentMethod: 'DIRECT_DEBIT' }));
    const xml = await inv.exportXml('ubl');
    expect(xml).not.toContain('PaymentMandate');
  });

  it('emits PayeeFinancialAccount with IBAN when code=58 and IBAN is present', async () => {
    const inv = service.buildEInvoice(baseData({
      paymentMethod: 'BANK_TRANSFER',
      paymentDetails: 'IBAN DE89370400440532013000',
    }));
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('DE89370400440532013000');
    expect(xml).toContain('PayeeFinancialAccount');
  });

  it('does NOT emit PayeeFinancialAccount when IBAN is absent', async () => {
    const inv = service.buildEInvoice(baseData({
      paymentMethod: 'BANK_TRANSFER',
      paymentDetails: 'Contact your bank',
    }));
    const xml = await inv.exportXml('ubl');
    expect(xml).not.toContain('PayeeFinancialAccount');
  });

  it('defaults to code 1 when paymentMethod is omitted', async () => {
    const inv = service.buildEInvoice(baseData());
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>');
  });
});

// ---------------------------------------------------------------------------
// buildEInvoice — document-level AllowanceCharge (discounts)
// ---------------------------------------------------------------------------

describe('buildEInvoice AllowanceCharge (document discount)', () => {
  const service = new InvoiceRenderingService();

  it('emits AllowanceCharge and AllowanceTotalAmount when discountRate > 0', async () => {
    // 10 items × €100 = €1000 gross; 10% discount = €100 allowance; net = €900
    const inv = service.buildEInvoice(baseData({ discountRate: 10 }));
    const xml = await inv.exportXml('ubl');
    // AllowanceCharge block
    expect(xml).toContain('AllowanceCharge');
    expect(xml).toContain('false'); // ChargeIndicator=false = discount
    // AllowanceTotalAmount
    expect(xml).toContain('AllowanceTotalAmount');
  });

  it('TaxExclusiveAmount equals net after discount', async () => {
    // 10 × 100 = 1000; 20% discount = 200; net = 800
    const inv = service.buildEInvoice(baseData({
      discountRate: 20,
      items: [{ name: 'Service', quantity: 10, unitPrice: 100, vatRate: 0, type: 'SERVICE' }],
    }));
    const xml = await inv.exportXml('ubl');
    // TaxExclusiveAmount should be 800.00 (not 1000.00)
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="EUR">800.00</cbc:TaxExclusiveAmount>');
  });

  it('does NOT emit AllowanceCharge when discountRate is 0 or absent', async () => {
    const inv1 = service.buildEInvoice(baseData({ discountRate: 0 }));
    const xml1 = await inv1.exportXml('ubl');
    expect(xml1).not.toContain('AllowanceTotalAmount');

    const inv2 = service.buildEInvoice(baseData());
    const xml2 = await inv2.exportXml('ubl');
    expect(xml2).not.toContain('AllowanceTotalAmount');
  });

  it('AllowanceCharge amount matches discountRate × LineExtensionAmount', async () => {
    // 2 × 500 = 1000; 5% discount = 50
    const inv = service.buildEInvoice(baseData({
      discountRate: 5,
      items: [{ name: 'License', quantity: 2, unitPrice: 500, vatRate: 19, type: 'SERVICE' }],
    }));
    const xml = await inv.exportXml('ubl');
    // Allowance amount = 50.00
    expect(xml).toContain('50.00');
  });

  it('negative-price items folded to document-level AllowanceCharge (BR-27 fix)', async () => {
    // Line 1: +5000; Line 2 (discount): -500 → net 4500.
    // BR-27 fix: negative-price item becomes a doc-level AllowanceCharge, not a negative-price line.
    const inv = service.buildEInvoice(baseData({
      items: [
        { name: 'Service', quantity: 1, unitPrice: 5000, vatRate: 20, type: 'SERVICE' },
        { name: 'Remise', quantity: 1, unitPrice: -500, vatRate: 20, type: 'SERVICE' },
      ],
    }));
    const xml = await inv.exportXml('ubl');
    // Only 1 positive-price InvoiceLine emitted (discount is doc-level, not a line)
    const lineCount = (xml.match(/<cac:InvoiceLine>/g) ?? []).length;
    expect(lineCount).toBe(1);
    // Doc-level AllowanceCharge present
    expect(xml).toContain('AllowanceCharge');
    // AllowanceTotalAmount = 500
    expect(xml).toContain('AllowanceTotalAmount');
    // No negative PriceAmount (BR-27 fix verified)
    expect(xml).not.toMatch(/PriceAmount[^>]*>-/);
    // TaxExclusiveAmount = 4500 (net after discount)
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="EUR">4500.00</cbc:TaxExclusiveAmount>');
  });
});

// ---------------------------------------------------------------------------
// extractMandateReference
// ---------------------------------------------------------------------------

describe('extractMandateReference', () => {
  it('extracts mandate reference from "MANDATE: REF" format', () => {
    expect(extractMandateReference('MANDATE: MNDT-2025-001')).toBe('MNDT-2025-001');
  });

  it('extracts mandate reference from "MANDATE/REF" format', () => {
    expect(extractMandateReference('MANDATE/MNDT-ABC-123')).toBe('MNDT-ABC-123');
  });

  it('extracts mandate reference case-insensitively', () => {
    expect(extractMandateReference('mandate:REF001')).toBe('REF001');
  });

  it('returns undefined when no mandate reference found', () => {
    expect(extractMandateReference(null)).toBeUndefined();
    expect(extractMandateReference('IBAN DE89370400440532013000')).toBeUndefined();
    expect(extractMandateReference('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildEInvoice — line-level AllowanceCharge (BG-27)
// ---------------------------------------------------------------------------

describe('buildEInvoice line-level AllowanceCharge (BG-27)', () => {
  const service = new InvoiceRenderingService();

  it('emits cac:AllowanceCharge inside cac:InvoiceLine when item has allowances', async () => {
    const inv = service.buildEInvoice(baseData({
      items: [{
        name: 'Consulting',
        quantity: 1,
        unitPrice: 1000,
        vatRate: 20,
        type: 'SERVICE',
        allowances: [{ reason: 'Volume discount', reasonCode: '95', amount: 100 }],
      }],
    }));
    const xml = await inv.exportXml('ubl');
    // Line net = 1000 - 100 = 900
    expect(xml).toContain('AllowanceCharge');
    expect(xml).toContain('Volume discount');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">900.00</cbc:LineExtensionAmount>');
    // TaxExclusiveAmount = 900 (discount already in line)
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="EUR">900.00</cbc:TaxExclusiveAmount>');
  });

  it('line-level allowance is reflected in correct LineExtensionAmount and document total', async () => {
    // 2 lines: line1 = 500 with allowance 50 → net 450; line2 = 200 plain → net 200; total = 650
    const inv = service.buildEInvoice(baseData({
      items: [
        { name: 'A', quantity: 1, unitPrice: 500, vatRate: 0, type: 'SERVICE',
          allowances: [{ reason: 'Early payment', amount: 50 }] },
        { name: 'B', quantity: 1, unitPrice: 200, vatRate: 0, type: 'SERVICE' },
      ],
    }));
    const xml = await inv.exportXml('ubl');
    // TaxExclusiveAmount = 450 + 200 = 650
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="EUR">650.00</cbc:TaxExclusiveAmount>');
    // PayableAmount = 650 (0% VAT)
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">650.00</cbc:PayableAmount>');
  });
});
