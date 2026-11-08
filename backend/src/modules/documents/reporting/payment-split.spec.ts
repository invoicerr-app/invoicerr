import { describe, expect, it } from 'vitest';

import { DeclaredInvoice } from './declaration-provider';
import { splitPaymentByVatRate } from './reporting-runner';

function invoice(): DeclaredInvoice {
  return {
    documentId: 'doc-1',
    typeId: 'invoice',
    number: 'INV-1',
    issueDate: '2027-10-01',
    currency: 'EUR',
    seller: {} as never,
    buyer: {} as never,
    lines: [
      {
        description: 'A',
        quantity: 1,
        unitPrice: 100,
        vatRatePercent: 20,
        netAmount: 100,
        vatAmount: 20,
        grossAmount: 120,
      },
      {
        description: 'B',
        quantity: 1,
        unitPrice: 50,
        vatRatePercent: 5.5,
        netAmount: 50,
        vatAmount: 2.75,
        grossAmount: 52.75,
      },
    ],
    netTotal: 150,
    vatTotal: 22.75,
    grossTotal: 172.75,
  };
}

describe('splitPaymentByVatRate', () => {
  it('splits the amount received proportionally to each rate and derives VAT from it', () => {
    const subtotals = splitPaymentByVatRate(invoice(), 172.75);
    expect(subtotals).toEqual([
      { vatRatePercent: 5.5, taxableAmount: 50, vatAmount: 2.75 },
      { vatRatePercent: 20, taxableAmount: 100, vatAmount: 20 },
    ]);
  });

  it('declares only the money actually collected on a partial payment', () => {
    const subtotals = splitPaymentByVatRate(invoice(), 86.38);
    const total = subtotals.reduce((sum, entry) => sum + entry.taxableAmount + entry.vatAmount, 0);
    expect(Math.round(total * 100) / 100).toBe(86.38);
  });

  it('refuses an invoice with no resolvable VAT rate rather than declaring zero', () => {
    const broken = invoice();
    broken.lines[0] = { ...broken.lines[0], vatRatePercent: null };
    expect(() => splitPaymentByVatRate(broken, 100)).toThrow(/no resolvable VAT rate/);
  });
});
