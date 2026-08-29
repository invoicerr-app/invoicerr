/**
 * The balance, and the distinction the product did not make.
 *
 * An invoice and the credit note correcting it used to ignore each other: a fully-credited invoice
 * stayed UNPAID for ever and kept chasing a customer who owed nothing.
 */
import { settlementOf } from './settlement';

describe('settlementOf', () => {
  it('a credit note reduces what is owed, exactly like a payment does', () => {
    const s = settlementOf({
      totalMinor: 120_00,
      paymentsMinor: [],
      credits: [{ id: 'cn-1', amountMinor: 50_00 }],
    });
    expect(s.outstandingMinor).toBe(70_00);
    expect(s.settled).toBe(false);
  });

  it('but it is counted SEPARATELY — a credit is not cash that arrived', () => {
    // A product that files a credit as a payment will one day report revenue it never received.
    const s = settlementOf({
      totalMinor: 120_00,
      paymentsMinor: [20_00],
      credits: [{ id: 'cn-1', amountMinor: 50_00 }],
    });
    expect(s.paidMinor).toBe(20_00);
    expect(s.creditedMinor).toBe(50_00);
    expect(s.outstandingMinor).toBe(50_00);
  });

  it('the sign the document carries does not matter', () => {
    // Credit notes were stored with negative totals for years and now carry positive ones — the
    // balance must not depend on which era a row comes from.
    const negative = settlementOf({
      totalMinor: 100_00,
      paymentsMinor: [],
      credits: [{ id: 'a', amountMinor: -100_00 }],
    });
    const positive = settlementOf({
      totalMinor: 100_00,
      paymentsMinor: [],
      credits: [{ id: 'a', amountMinor: 100_00 }],
    });
    expect(negative).toEqual(positive);
    expect(positive.settled).toBe(true);
  });

  it('a fully credited invoice is settled and owes NOTHING — not a negative amount', () => {
    const s = settlementOf({
      totalMinor: 100_00,
      paymentsMinor: [],
      credits: [{ id: 'a', amountMinor: 150_00 }],
    });
    expect(s.settled).toBe(true);
    // Whether the excess is refundable is a question this function must not answer.
    expect(s.outstandingMinor).toBe(0);
  });

  it('nothing credited and nothing paid leaves the whole amount owed', () => {
    const s = settlementOf({ totalMinor: 120_00, paymentsMinor: [], credits: [] });
    expect(s).toEqual({
      totalMinor: 120_00,
      paidMinor: 0,
      creditedMinor: 0,
      outstandingMinor: 120_00,
      settled: false,
    });
  });
});
