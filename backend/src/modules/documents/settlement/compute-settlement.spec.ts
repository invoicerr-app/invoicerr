import { computeSettlement, describeSettlement } from './compute-settlement';

describe('computeSettlement', () => {
  it('zero payments — everything is outstanding, nothing is settled', () => {
    const settlement = computeSettlement(10000, []);
    expect(settlement).toEqual({
      totalGrossMinor: 10000,
      paidMinor: 0,
      creditedMinor: 0,
      outstandingMinor: 10000,
      excessMinor: 0,
      settled: false,
    });
  });

  it('a PARTIAL payment leaves a positive outstanding balance, not settled', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 4000 }]);
    expect(settlement).toEqual({
      totalGrossMinor: 10000,
      paidMinor: 4000,
      creditedMinor: 0,
      outstandingMinor: 6000,
      excessMinor: 0,
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
      creditedMinor: 0,
      outstandingMinor: 0,
      excessMinor: 0,
      settled: true,
    });
  });

  it('an OVERPAYMENT never drives outstandingMinor negative, but the excess stays VISIBLE', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 12000 }]);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.excessMinor).toBe(2000);
    expect(settlement.settled).toBe(true);
  });

  it('a zero-total document with no payments is settled — there was never anything to pay', () => {
    const settlement = computeSettlement(0, []);
    expect(settlement.settled).toBe(true);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.excessMinor).toBe(0);
  });

  it('credits default to none when the third argument is omitted — every pre-existing call site keeps working unmodified', () => {
    const withDefault = computeSettlement(10000, [{ amountMinor: 4000 }]);
    const withExplicitEmpty = computeSettlement(10000, [{ amountMinor: 4000 }], []);
    expect(withDefault).toEqual(withExplicitEmpty);
  });
});

/**
 * CREDITS (item 8 of the root TODO — "le lettrage"). A credit note is NOT a payment — see this
 * module's own header — so every test here checks `paidMinor`/`creditedMinor` SEPARATELY, never as
 * one merged "amount settled" figure, even where their SUM is also asserted.
 */
describe('computeSettlement — with CREDITS', () => {
  it('a PARTIAL credit reduces what is owed, exactly like a payment does — reported as `creditedMinor`, not `paidMinor`', () => {
    const settlement = computeSettlement(12000, [], [{ id: 'cn-1', amountMinor: 5000 }]);
    expect(settlement.paidMinor).toBe(0);
    expect(settlement.creditedMinor).toBe(5000);
    expect(settlement.outstandingMinor).toBe(7000);
    expect(settlement.settled).toBe(false);
  });

  it('a TOTAL credit settles the document with zero paid — never reported as "paid"', () => {
    const settlement = computeSettlement(12000, [], [{ id: 'cn-1', amountMinor: 12000 }]);
    expect(settlement).toEqual({
      totalGrossMinor: 12000,
      paidMinor: 0,
      creditedMinor: 12000,
      outstandingMinor: 0,
      excessMinor: 0,
      settled: true,
    });
  });

  it('several credits accumulate — the sum is what counts, not any single one', () => {
    const settlement = computeSettlement(
      12000,
      [],
      [
        { id: 'cn-1', amountMinor: 3000 },
        { id: 'cn-2', amountMinor: 4000 },
      ],
    );
    expect(settlement.creditedMinor).toBe(7000);
    expect(settlement.outstandingMinor).toBe(5000);
  });

  it('a PAYMENT and a CREDIT mixed stay two SEPARATE figures — never merged — and together they settle the balance', () => {
    const settlement = computeSettlement(
      12000,
      [{ amountMinor: 2000 }],
      [{ id: 'cn-1', amountMinor: 10000 }],
    );
    expect(settlement.paidMinor).toBe(2000);
    expect(settlement.creditedMinor).toBe(10000);
    // The two separate lines SUM to the balance: 2000 + 10000 === 12000, fully settled.
    expect(settlement.paidMinor + settlement.creditedMinor).toBe(12000);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.settled).toBe(true);
  });

  it('a payment and a credit mixed, NOT yet covering the total, leaves the remainder outstanding', () => {
    const settlement = computeSettlement(12000, [{ amountMinor: 2000 }], [{ id: 'cn-1', amountMinor: 5000 }]);
    expect(settlement.paidMinor).toBe(2000);
    expect(settlement.creditedMinor).toBe(5000);
    expect(settlement.outstandingMinor).toBe(5000);
    expect(settlement.settled).toBe(false);
  });

  it('an OVER-credited document (zero payments) is settled and owes NOTHING — the excess stays VISIBLE, never a negative outstanding', () => {
    const settlement = computeSettlement(10000, [], [{ id: 'cn-1', amountMinor: 15000 }]);
    expect(settlement.paidMinor).toBe(0);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.excessMinor).toBe(5000);
    expect(settlement.settled).toBe(true);
  });

  it('an excess split across a payment AND a credit is still ONE visible `excessMinor`, never a negative outstanding', () => {
    const settlement = computeSettlement(10000, [{ amountMinor: 4000 }], [{ id: 'cn-1', amountMinor: 9000 }]);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.excessMinor).toBe(3000); // 4000 + 9000 - 10000
    expect(settlement.settled).toBe(true);
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
