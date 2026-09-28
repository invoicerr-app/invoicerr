import { CurrencyRateLike } from '../../company/currency-rates/convert';
import {
  buildCashedRevenuePeriods,
  CashedPaymentLike,
  enumeratePeriodKeys,
  periodBounds,
  periodKeyFor,
  periodLabelFor,
} from './cashed-revenue';

function payment(overrides: Partial<CashedPaymentLike> = {}): CashedPaymentLike {
  return { currency: 'EUR', amountMinor: 10000, paidAt: new Date('2026-08-10'), ...overrides };
}

describe('periodKeyFor / periodBounds / periodLabelFor', () => {
  it('monthly: buckets by calendar month', () => {
    expect(periodKeyFor(new Date('2026-08-15T12:00:00.000Z'), 'monthly')).toBe('2026-08');
    expect(periodBounds('2026-08', 'monthly')).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    expect(periodLabelFor('2026-08', 'monthly')).toBe('August 2026');
  });

  it('quarterly: buckets by calendar quarter', () => {
    expect(periodKeyFor(new Date('2026-08-15T12:00:00.000Z'), 'quarterly')).toBe('2026-Q3');
    expect(periodBounds('2026-Q3', 'quarterly')).toEqual({ dateFrom: '2026-07-01', dateTo: '2026-09-30' });
    expect(periodLabelFor('2026-Q3', 'quarterly')).toBe('Q3 2026');
  });

  it('quarterly: the last quarter of a year spans into December, leap years handled by Date itself', () => {
    expect(periodBounds('2026-Q4', 'quarterly')).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-12-31' });
    expect(periodBounds('2028-Q1', 'quarterly')).toEqual({ dateFrom: '2028-01-01', dateTo: '2028-03-31' });
  });
});

describe('enumeratePeriodKeys', () => {
  it('monthly: every month in range, oldest first, inclusive of both ends', () => {
    expect(enumeratePeriodKeys('2026-06-01', '2026-08-31', 'monthly')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
  });

  it('quarterly: every quarter in range', () => {
    expect(enumeratePeriodKeys('2026-01-01', '2026-12-31', 'quarterly')).toEqual([
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
    ]);
  });
});

describe('buildCashedRevenuePeriods', () => {
  it('a period with nothing cashed still appears, at zero - never silently skipped', () => {
    const periods = buildCashedRevenuePeriods([], '2026-07-01', '2026-08-31', 'monthly', null, []);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ key: '2026-07', byCurrency: [], consolidated: null, warnings: [] });
    expect(periods[1]).toMatchObject({ key: '2026-08', byCurrency: [], consolidated: null, warnings: [] });
  });

  it('buckets payments into the period their own paidAt falls in, per currency', () => {
    const periods = buildCashedRevenuePeriods(
      [
        payment({ currency: 'EUR', amountMinor: 10000, paidAt: new Date('2026-07-15') }),
        payment({ currency: 'USD', amountMinor: 5000, paidAt: new Date('2026-08-02') }),
      ],
      '2026-07-01',
      '2026-08-31',
      'monthly',
      null,
      [],
    );
    expect(periods[0].byCurrency).toEqual([{ currency: 'EUR', totalMinor: 10000 }]);
    expect(periods[1].byCurrency).toEqual([{ currency: 'USD', totalMinor: 5000 }]);
  });

  it('no referenceCurrency: byCurrency totals present, consolidated always null', () => {
    const periods = buildCashedRevenuePeriods(
      [payment({ currency: 'USD', amountMinor: 5000, paidAt: new Date('2026-08-02') })],
      '2026-08-01',
      '2026-08-31',
      'monthly',
      null,
      [],
    );
    expect(periods[0].consolidated).toBeNull();
    expect(periods[0].warnings).toEqual([]);
  });

  it('every currency resolves: ONE consolidated total, rate dated to EACH payment’s own paidAt', () => {
    const rates: CurrencyRateLike[] = [
      { from: 'USD', to: 'EUR', rate: 0.9, asOf: new Date('2026-08-01'), source: 'manual' },
      { from: 'USD', to: 'EUR', rate: 0.92, asOf: new Date('2026-08-20'), source: 'manual' },
    ];
    const periods = buildCashedRevenuePeriods(
      [
        payment({ currency: 'EUR', amountMinor: 10000, paidAt: new Date('2026-08-05') }),
        // Paid BEFORE the 0.92 rate existed -> must resolve at 0.90, not 0.92.
        payment({ currency: 'USD', amountMinor: 5000, paidAt: new Date('2026-08-10') }),
        // Paid AFTER the 0.92 rate -> resolves at 0.92, a DIFFERENT rate from the payment above, in
        // the SAME currency, the same period.
        payment({ currency: 'USD', amountMinor: 5000, paidAt: new Date('2026-08-25') }),
      ],
      '2026-08-01',
      '2026-08-31',
      'monthly',
      'EUR',
      rates,
    );

    // 100.00 EUR + (50.00 USD * 0.90 = 45.00 EUR) + (50.00 USD * 0.92 = 46.00 EUR) = 191.00 EUR.
    expect(periods[0].consolidated).toEqual({
      currency: 'EUR',
      totalMinor: 19100,
      notes: ['USD→EUR @ 0.9 (manual, 2026-08-01)', 'USD→EUR @ 0.92 (manual, 2026-08-20)'],
    });
  });

  it('THE fix this issue exists for: a rate dated TODAY never changes an already-closed period', () => {
    // Simulates "last month is closed; today someone enters a brand-new rate dated to today".
    const lastMonthPayment = payment({ currency: 'USD', amountMinor: 10000, paidAt: new Date('2026-07-15') });
    const ratesBefore: CurrencyRateLike[] = [
      { from: 'USD', to: 'EUR', rate: 0.9, asOf: new Date('2026-07-01'), source: 'manual' },
    ];
    const before = buildCashedRevenuePeriods(
      [lastMonthPayment],
      '2026-07-01',
      '2026-07-31',
      'monthly',
      'EUR',
      ratesBefore,
    );

    const ratesAfter: CurrencyRateLike[] = [
      ...ratesBefore,
      // A brand-new rate, dated TODAY (2026-08-28) - long after July closed.
      { from: 'USD', to: 'EUR', rate: 1.5, asOf: new Date('2026-08-28'), source: 'manual' },
    ];
    const after = buildCashedRevenuePeriods(
      [lastMonthPayment],
      '2026-07-01',
      '2026-07-31',
      'monthly',
      'EUR',
      ratesAfter,
    );

    expect(before[0].consolidated?.totalMinor).toBe(9000); // 100.00 USD * 0.90 = 90.00 EUR
    expect(after[0].consolidated?.totalMinor).toBe(9000); // UNCHANGED - the new rate post-dates July.
    expect(after[0].consolidated?.notes).toEqual(before[0].consolidated?.notes);
  });

  it('a currency missing a rate for even one payment: no consolidated total for the period, named warning', () => {
    const rates: CurrencyRateLike[] = [
      { from: 'USD', to: 'EUR', rate: 0.9, asOf: new Date('2026-08-01'), source: 'manual' },
    ];
    const periods = buildCashedRevenuePeriods(
      [
        // Paid BEFORE the only USD->EUR rate exists -> unresolvable at its own paidAt.
        payment({ currency: 'USD', amountMinor: 5000, paidAt: new Date('2026-07-31') }),
      ],
      '2026-07-01',
      '2026-07-31',
      'monthly',
      'EUR',
      rates,
    );
    expect(periods[0].consolidated).toBeNull();
    expect(periods[0].warnings).toEqual(['No USD→EUR rate is set - consolidated total omitted.']);
    // The per-currency breakdown is still honest and complete, unaffected.
    expect(periods[0].byCurrency).toEqual([{ currency: 'USD', totalMinor: 5000 }]);
  });

  it('a payment in the reference currency itself needs no rate and contributes no note', () => {
    const periods = buildCashedRevenuePeriods(
      [payment({ currency: 'EUR', amountMinor: 10000, paidAt: new Date('2026-08-05') })],
      '2026-08-01',
      '2026-08-31',
      'monthly',
      'EUR',
      [],
    );
    expect(periods[0].consolidated).toEqual({ currency: 'EUR', totalMinor: 10000, notes: [] });
  });
});
