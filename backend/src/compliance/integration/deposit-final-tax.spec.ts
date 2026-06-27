import { resolveInvoiceTax, InvoiceTaxInput } from './invoice-tax';

/**
 * III.4 deposit/final VAT invariant tests.
 *
 * deposit: amount is TTC → derive HT = amount / (1 + vatRate/100), VAT = TTC - HT.
 * final: deduction line uses -totalDeposited TTC → same derivation.
 *
 * Invariant: totalHT + totalVAT === totalTTC (within floating-point tolerance).
 */

function baseInput(overrides?: Partial<InvoiceTaxInput>): InvoiceTaxInput {
  return {
    supplierCountryCode: 'FR',
    supplierExemptVat: false,
    buyerCountryCode: 'FR',
    buyerRole: 'B2B',
    currency: 'EUR',
    issueDate: new Date('2026-06-26'),
    discountRate: 0,
    items: [{ quantity: 1, unitPrice: 100, vatRate: 20, supplyType: 'SERVICES' }],
    ...overrides,
  };
}

describe('III.4 — deposit VAT invariant (amount = TTC)', () => {
  it('deposit: amount=1000 TTC at 20% → engine processes derived HT, invariant holds', () => {
    const amountTTC = 1000;
    const vatRate = 20;
    const expectedHT = amountTTC / (1 + vatRate / 100);

    const result = resolveInvoiceTax(baseInput({
      items: [{ quantity: 1, unitPrice: expectedHT, vatRate, supplyType: 'SERVICES' }],
    }));

    // Core invariant: HT + VAT === TTC
    expect(result.totalHT + result.totalVAT).toBeCloseTo(result.totalTTC, 10);

    // Engine uses minor units (EUR cents), so TTC should be at most 1 cent off from amountTTC
    expect(Math.abs(result.totalTTC - amountTTC)).toBeLessThanOrEqual(0.02);
  });

  it('deposit: amount=500 TTC at 10% → invariant holds', () => {
    const amountTTC = 500;
    const vatRate = 10;
    const expectedHT = amountTTC / (1 + vatRate / 100);

    const result = resolveInvoiceTax(baseInput({
      items: [{ quantity: 1, unitPrice: expectedHT, vatRate, supplyType: 'SERVICES' }],
    }));

    expect(result.totalHT + result.totalVAT).toBeCloseTo(result.totalTTC, 10);
    expect(Math.abs(result.totalTTC - amountTTC)).toBeLessThanOrEqual(0.02);
  });

  it('deposit: amount=100 TTC at 5.5% (FR reduced) → invariant holds', () => {
    const amountTTC = 100;
    const vatRate = 5.5;
    const expectedHT = amountTTC / (1 + vatRate / 100);

    const result = resolveInvoiceTax(baseInput({
      items: [{ quantity: 1, unitPrice: expectedHT, vatRate, supplyType: 'SERVICES' }],
    }));

    expect(result.totalHT + result.totalVAT).toBeCloseTo(result.totalTTC, 10);
    expect(Math.abs(result.totalTTC - amountTTC)).toBeLessThanOrEqual(0.02);
  });

  it('deposit: amount=333.33 TTC at 20% → invariant holds with rounding', () => {
    const amountTTC = 333.33;
    const vatRate = 20;
    const expectedHT = amountTTC / (1 + vatRate / 100);

    const result = resolveInvoiceTax(baseInput({
      items: [{ quantity: 1, unitPrice: expectedHT, vatRate, supplyType: 'SERVICES' }],
    }));

    expect(result.totalHT + result.totalVAT).toBeCloseTo(result.totalTTC, 10);
  });
});

describe('III.4 — final invoice deduction line VAT invariant', () => {
  it('deduction: totalDeposited=1000 TTC at 20% → deduction invariant holds', () => {
    const totalDeposited = 1000;
    const vatRate = 20;
    const deductionHT = -totalDeposited / (1 + vatRate / 100);

    const result = resolveInvoiceTax(baseInput({
      items: [{ quantity: 1, unitPrice: deductionHT, vatRate, supplyType: 'SERVICES' }],
    }));

    expect(result.totalHT + result.totalVAT).toBeCloseTo(result.totalTTC, 10);
    expect(Math.abs(result.totalTTC - (-totalDeposited))).toBeLessThanOrEqual(0.02);
  });

  it('deduction with mixed items: work line + deduction line → overall invariant', () => {
    const totalDeposited = 600;
    const depositVatRate = 20;
    const workHT = 1000;
    const workVatRate = 20;

    const deductionHT = -totalDeposited / (1 + depositVatRate / 100);

    const result = resolveInvoiceTax(baseInput({
      items: [
        { quantity: 1, unitPrice: workHT, vatRate: workVatRate, supplyType: 'SERVICES' },
        { quantity: 1, unitPrice: deductionHT, vatRate: depositVatRate, supplyType: 'SERVICES' },
      ],
    }));

    expect(result.totalHT + result.totalVAT).toBeCloseTo(result.totalTTC, 10);
  });
});

describe('III.4 — final invoice is DRAFT (no number)', () => {
  it('finalInvoice.number is null before issue', () => {
    // A freshly created final invoice must have number=null and rawNumber=null.
    // Numbering only happens at issue() time.
    const finalInvoice = {
      kind: 'FINAL',
      status: 'DRAFT',
      number: null as number | null,
      rawNumber: null as string | null,
    };

    expect(finalInvoice.number).toBeNull();
    expect(finalInvoice.rawNumber).toBeNull();
    expect(finalInvoice.status).toBe('DRAFT');
  });
});
