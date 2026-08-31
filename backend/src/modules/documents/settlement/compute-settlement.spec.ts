import { computeSettlement, describeSettlement } from './compute-settlement';

describe('computeSettlement', () => {
  it('zero payments — everything is outstanding, nothing is settled', () => {
    const settlement = computeSettlement(10000, []);
    expect(settlement).toEqual({
      totalGrossMinor: 10000,
      paidMinor: 0,
      outstandingMinor: 10000,
      overpaidMinor: 0,
      settled: false,
    });
  });

  it('a PARTIAL payment leaves a positive outstanding balance, not settled', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 4000 }]);
    expect(settlement).toEqual({
      totalGrossMinor: 10000,
      paidMinor: 4000,
      outstandingMinor: 6000,
      overpaidMinor: 0,
      settled: false,
    });
  });

  it('several partial payments accumulate — the sum is what counts, not any single one', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 4000 }, { amountMinor: 1500 }]);
    expect(settlement.paidMinor).toBe(5500);
    expect(settlement.outstandingMinor).toBe(4500);
    expect(settlement.settled).toBe(false);
  });

  it('an EXACT payment settles the document with a zero balance, not a negative one', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 10000 }]);
    expect(settlement).toEqual({
      totalGrossMinor: 10000,
      paidMinor: 10000,
      outstandingMinor: 0,
      overpaidMinor: 0,
      settled: true,
    });
  });

  it('an OVERPAYMENT never drives outstandingMinor negative, but the excess stays VISIBLE', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 12000 }]);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.overpaidMinor).toBe(2000);
    expect(settlement.settled).toBe(true);
  });

  it('a zero-total document with no payments is settled — there was never anything to pay', () => {
    const settlement = computeSettlement(0, []);
    expect(settlement.settled).toBe(true);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.overpaidMinor).toBe(0);
  });
});

describe('describeSettlement', () => {
  it('states the paid and outstanding amounts for a partial payment', () => {
    const message = describeSettlement(computeSettlement(10000, [{ amountMinor: 4000 }]), 'EUR');
    expect(message).toMatch(/40\.00 EUR/);
    expect(message).toMatch(/60\.00 EUR/);
    expect(message).toMatch(/outstanding/i);
  });

  it('states the document is fully paid once settled, with no mention of "outstanding"', () => {
    const message = describeSettlement(computeSettlement(10000, [{ amountMinor: 10000 }]), 'EUR');
    expect(message).toMatch(/fully paid/i);
    expect(message).not.toMatch(/outstanding/i);
  });

  it('calls out the overpaid amount explicitly, rather than silently reporting it as fully paid', () => {
    const message = describeSettlement(computeSettlement(10000, [{ amountMinor: 12000 }]), 'EUR');
    expect(message).toMatch(/overpaid/i);
    expect(message).toMatch(/20\.00 EUR/);
  });

  it("respects the currency's own decimals — JPY has none", () => {
    // 10000 JPY total (0 decimals — see @/utils/financial's decimalsFor), half paid.
    const message = describeSettlement(computeSettlement(10000, [{ amountMinor: 5000 }]), 'JPY');
    expect(message).toMatch(/5000 JPY/);
    expect(message).not.toMatch(/5000\.00/);
  });
});
