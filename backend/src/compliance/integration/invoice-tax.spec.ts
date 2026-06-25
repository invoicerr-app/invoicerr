import { calculateDiscountedTotals } from '../../utils/financial';
import { resolveInvoiceTax, InvoiceTaxInput } from './invoice-tax';

function makeInput(overrides?: Partial<InvoiceTaxInput>): InvoiceTaxInput {
  return {
    supplierCountryCode: 'FR',
    supplierExemptVat: false,
    buyerCountryCode: 'FR',
    buyerRole: 'B2B',
    currency: 'EUR',
    issueDate: new Date('2026-06-24'),
    discountRate: 0,
    items: [{ quantity: 1, unitPrice: 100, vatRate: 20, supplyType: 'SERVICES' }],
    ...overrides,
  };
}

describe('resolveInvoiceTax', () => {
  it('FR→FR domestic, non-exempt: standard 20% VAT', () => {
    const result = resolveInvoiceTax(makeInput());
    expect(result.totalHT).toBeCloseTo(100, 5);
    expect(result.totalVAT).toBeCloseTo(20, 5);
    expect(result.totalTTC).toBeCloseTo(120, 5);
    expect(result.itemVatRates).toEqual([20]);
    expect(result.warnings).toEqual([]);
  });

  it('FR→FR, exemptVat: 0% VAT (existing behavior preserved)', () => {
    const result = resolveInvoiceTax(makeInput({ supplierExemptVat: true }));
    expect(result.totalHT).toBeCloseTo(100, 5);
    expect(result.totalVAT).toBe(0);
    expect(result.totalTTC).toBe(100);
    expect(result.itemVatRates).toEqual([0]);
  });

  it('DE→DE, exemptVat: 0% VAT — THE BUG FIX', () => {
    const result = resolveInvoiceTax(
      makeInput({ supplierCountryCode: 'DE', buyerCountryCode: 'DE', supplierExemptVat: true }),
    );
    expect(result.totalVAT).toBe(0);
    expect(result.totalTTC).toBe(result.totalHT);
    expect(result.itemVatRates).toEqual([0]);
  });

  it('FR→DE B2B services, VAT numbers supplied but NOT verified: conservative fallback, full French VAT (never under-charge)', () => {
    // Company.VAT/Client.VAT are free-text fields nobody validates today (no VIES integration yet —
    // tracked separately). Typing a VAT-shaped string must NOT be enough to unlock reverse charge;
    // the engine's TrustFlagVatValidator only trusts `validated === true`, which resolveInvoiceTax
    // never claims for these. Real EU B2B reverse charge lands once a real validator is wired in.
    const result = resolveInvoiceTax(
      makeInput({
        buyerCountryCode: 'DE',
        buyerRole: 'B2B',
        supplierVatNumber: 'FR123456789',
        buyerVatNumber: 'DE987654321',
      }),
    );
    expect(result.totalVAT).toBeCloseTo(20, 5);
    expect(result.totalTTC).toBeCloseTo(120, 5);
    expect(result.itemVatRates).toEqual([20]);
  });

  it('reduced-rate hint (5.5%) is respected for domestic supply', () => {
    const result = resolveInvoiceTax(
      makeInput({
        items: [{ quantity: 1, unitPrice: 100, vatRate: 5.5, supplyType: 'SERVICES' }],
      }),
    );
    expect(result.totalHT).toBeCloseTo(100, 5);
    expect(result.totalVAT).toBeCloseTo(5.5, 5);
    expect(result.totalTTC).toBeCloseTo(105.5, 5);
    expect(result.itemVatRates).toEqual([5.5]);
  });

  it('FR→US export: outside scope, 0% VAT', () => {
    const result = resolveInvoiceTax(makeInput({ buyerCountryCode: 'US' }));
    expect(result.totalVAT).toBe(0);
    expect(result.totalTTC).toBe(result.totalHT);
    expect(typeof result.totalHT).toBe('number');
    expect(Number.isNaN(result.totalHT)).toBe(false);
  });

  it('unresolvable buyer country: safe fallback, warnings present', () => {
    const result = resolveInvoiceTax(makeInput({ buyerCountryCode: undefined }));
    expect(Number.isNaN(result.totalVAT)).toBe(false);
    expect(typeof result.totalVAT).toBe('number');
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes('FALLBACK'))).toBe(true);
  });

  it('discount: math matches calculateDiscountedTotals within 1 minor unit', () => {
    const items = [
      { quantity: 2, unitPrice: 150, vatRate: 20, supplyType: 'SERVICES' as const },
      { quantity: 1, unitPrice: 50, vatRate: 10, supplyType: 'GOODS' as const },
    ];
    const discountRate = 10;

    const result = resolveInvoiceTax(
      makeInput({
        discountRate,
        items: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate, supplyType: i.supplyType })),
      }),
    );

    const legacy = calculateDiscountedTotals(
      items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate })),
      discountRate,
    );

    const diffHT = Math.abs(result.totalHT - legacy.totalHT);
    const diffVAT = Math.abs(result.totalVAT - legacy.totalVAT);
    const diffTTC = Math.abs(result.totalTTC - legacy.totalTTC);

    // 1 minor unit = 0.01 EUR
    expect(diffHT).toBeLessThanOrEqual(0.01);
    expect(diffVAT).toBeLessThanOrEqual(0.01);
    expect(diffTTC).toBeLessThanOrEqual(0.02);
  });
});
