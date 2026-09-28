import { vi, type Mock } from 'vitest';

import { CurrencyRateLike } from '../../company/currency-rates/convert';
import * as currencyRatesStore from '../../company/currency-rates/currency-rates.store';
import {
  consolidateByCurrency,
  loadCurrencyContext,
  resolveConsolidationInstant,
} from './currency-consolidation';

// Only the two DB-touching reads are mocked — `toCurrencyRateLikes` stays the REAL pure mapper
// (same "mock only what touches Prisma" discipline invoice-contributions.spec.ts already applies to
// settlement/credits.ts's own `listCreditNotes`).
vi.mock('../../company/currency-rates/currency-rates.store', async () => {
  const actual = await vi.importActual('../../company/currency-rates/currency-rates.store');
  return { ...actual, getReferenceCurrency: vi.fn(), listCurrencyRates: vi.fn() };
});

const getReferenceCurrency = currencyRatesStore.getReferenceCurrency as Mock;
const listCurrencyRates = currencyRatesStore.listCurrencyRates as Mock;

const now = new Date('2026-08-28T00:00:00.000Z');

function usdToEurRate(overrides: Partial<CurrencyRateLike> = {}): CurrencyRateLike {
  return { from: 'USD', to: 'EUR', rate: 0.92, asOf: new Date('2026-08-15'), source: 'manual', ...overrides };
}

describe('consolidateByCurrency', () => {
  it('without a referenceCurrency: no consolidation attempted at all — existing per-currency behavior is untouched', () => {
    const outcome = consolidateByCurrency([{ currency: 'EUR', totalMinor: 10000 }], null, [], now);
    expect(outcome).toEqual({ consolidated: null, warnings: [] });
  });

  it('with an empty referenceCurrency string: same as no reference currency (falsy)', () => {
    const outcome = consolidateByCurrency([{ currency: 'EUR', totalMinor: 10000 }], '', [], now);
    expect(outcome.consolidated).toBeNull();
  });

  it('no amounts at all: nothing to consolidate, not an error — no warnings either', () => {
    const outcome = consolidateByCurrency([], 'EUR', [usdToEurRate()], now);
    expect(outcome).toEqual({ consolidated: null, warnings: [] });
  });

  it('every currency resolves: ONE consolidated total, hand-checked, naming every rate it used', () => {
    // 100.00 EUR (already the reference currency, contributes untouched) + 50.00 USD converted at
    // 0.92: major 50 * 0.92 = 46.00 EUR -> minor 4600. Total: 10000 + 4600 = 14600 (146.00 EUR).
    const outcome = consolidateByCurrency(
      [
        { currency: 'EUR', totalMinor: 10000 },
        { currency: 'USD', totalMinor: 5000 },
      ],
      'EUR',
      [usdToEurRate()],
      now,
    );

    expect(outcome.consolidated).toEqual({
      totalMinor: 14600,
      currency: 'EUR',
      notes: ['USD→EUR @ 0.92 (manual, 2026-08-15)'],
    });
    expect(outcome.warnings).toEqual([]);
  });

  it('a currency identical to the reference currency contributes no conversion note', () => {
    const outcome = consolidateByCurrency([{ currency: 'EUR', totalMinor: 10000 }], 'EUR', [], now);
    expect(outcome.consolidated).toEqual({ totalMinor: 10000, currency: 'EUR', notes: [] });
  });

  it('a currency with NO resolvable rate: no consolidated total AT ALL (never partial), and a warning naming it', () => {
    const outcome = consolidateByCurrency(
      [
        { currency: 'EUR', totalMinor: 10000 },
        { currency: 'JPY', totalMinor: 10000 }, // no JPY→EUR rate supplied below
      ],
      'EUR',
      [usdToEurRate()], // present, but for a DIFFERENT pair — irrelevant to JPY
      now,
    );

    expect(outcome.consolidated).toBeNull();
    expect(outcome.warnings).toEqual(['No JPY→EUR rate is set — consolidated total omitted.']);
  });

  it('several missing currencies are each named, not just the first', () => {
    const outcome = consolidateByCurrency(
      [
        { currency: 'JPY', totalMinor: 1000 },
        { currency: 'GBP', totalMinor: 1000 },
      ],
      'EUR',
      [],
      now,
    );

    expect(outcome.consolidated).toBeNull();
    expect(outcome.warnings).toEqual([
      'No JPY→EUR rate is set — consolidated total omitted.',
      'No GBP→EUR rate is set — consolidated total omitted.',
    ]);
  });

  it('never derives an inverse rate: a stored EUR→USD rate does not let USD consolidate into EUR', () => {
    const outcome = consolidateByCurrency(
      [{ currency: 'USD', totalMinor: 5000 }],
      'EUR',
      [{ from: 'EUR', to: 'USD', rate: 1.1, asOf: new Date('2026-08-01'), source: 'manual' }],
      now,
    );

    expect(outcome.consolidated).toBeNull();
    expect(outcome.warnings).toEqual(['No USD→EUR rate is set — consolidated total omitted.']);
  });

  it('a future-dated rate is not eligible — treated the same as no rate at all', () => {
    const outcome = consolidateByCurrency(
      [{ currency: 'USD', totalMinor: 5000 }],
      'EUR',
      [usdToEurRate({ asOf: new Date('2026-12-25') })],
      now,
    );

    expect(outcome.consolidated).toBeNull();
    expect(outcome.warnings).toEqual(['No USD→EUR rate is set — consolidated total omitted.']);
  });
});

describe('resolveConsolidationInstant', () => {
  it('no period: resolves at "now", exactly the pre-#516 behavior', () => {
    expect(resolveConsolidationInstant(undefined, now)).toEqual(now);
  });

  it('a CLOSED period (dateTo already in the past): resolves at the END of its own dateTo, never "now"', () => {
    const period = { dateFrom: '2026-07-01', dateTo: '2026-07-31' };
    expect(resolveConsolidationInstant(period, now)).toEqual(new Date('2026-07-31T23:59:59.999Z'));
  });

  it('an OPEN period (dateTo still in the future/today): clamped to "now", never a future instant', () => {
    const period = { dateFrom: '2026-08-01', dateTo: '2026-09-30' };
    expect(resolveConsolidationInstant(period, now)).toEqual(now);
  });

  it('THE fix this issue exists for: a closed period does not move when "now" advances past a new rate', () => {
    const closedPeriod = { dateFrom: '2026-07-01', dateTo: '2026-07-31' };
    const instantBeforeNewRate = resolveConsolidationInstant(
      closedPeriod,
      new Date('2026-08-01T00:00:00.000Z'),
    );
    const instantAfterNewRate = resolveConsolidationInstant(
      closedPeriod,
      new Date('2026-09-15T00:00:00.000Z'),
    );
    // Both resolve to the SAME instant (July's own end) no matter how far "now" has moved on -
    // meaning any rate dated after July 31st can never be picked up by this period.
    expect(instantBeforeNewRate).toEqual(instantAfterNewRate);
    expect(instantBeforeNewRate).toEqual(new Date('2026-07-31T23:59:59.999Z'));
  });

  it('integration with consolidateByCurrency: a rate dated TODAY never changes an already-closed period', () => {
    const closedPeriod = { dateFrom: '2026-07-01', dateTo: '2026-07-31' };
    const amounts = [{ currency: 'USD', totalMinor: 10000 }];
    const ratesBeforeToday = [usdToEurRate({ asOf: new Date('2026-07-01') })];

    const before = consolidateByCurrency(
      amounts,
      'EUR',
      ratesBeforeToday,
      resolveConsolidationInstant(closedPeriod, now),
    );

    // A brand-new rate, dated TODAY (2026-08-28, "now") - long after July closed.
    const ratesAfterToday = [...ratesBeforeToday, usdToEurRate({ rate: 5, asOf: now })];
    const after = consolidateByCurrency(
      amounts,
      'EUR',
      ratesAfterToday,
      resolveConsolidationInstant(closedPeriod, now),
    );

    expect(before.consolidated?.totalMinor).toBe(after.consolidated?.totalMinor);
    expect(after.consolidated?.notes).toEqual(before.consolidated?.notes);
  });
});

describe('loadCurrencyContext', () => {
  beforeEach(() => {
    getReferenceCurrency.mockReset();
    listCurrencyRates.mockReset();
  });

  it('carries the reference currency and rates through untouched on the happy path', async () => {
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([
      {
        id: 'r1',
        companyId: 'c1',
        from: 'USD',
        to: 'EUR',
        rate: 0.92,
        asOf: new Date('2026-08-15'),
        source: 'manual',
        createdAt: new Date('2026-08-15'),
      },
    ]);

    const context = await loadCurrencyContext('c1');

    expect(context.referenceCurrency).toBe('EUR');
    expect(context.rates).toEqual([
      { from: 'USD', to: 'EUR', rate: 0.92, asOf: new Date('2026-08-15'), source: 'manual' },
    ]);
  });

  it('a company that never set a referenceCurrency resolves to null, exactly the "no consolidation" input', async () => {
    getReferenceCurrency.mockResolvedValue(null);
    listCurrencyRates.mockResolvedValue([]);

    expect(await loadCurrencyContext('c1')).toEqual({ referenceCurrency: null, rates: [] });
  });

  it('ANY failure fetching the context (DB unreachable, etc.) degrades to "no consolidation", never throws', async () => {
    getReferenceCurrency.mockRejectedValue(new Error('connect ECONNREFUSED'));
    listCurrencyRates.mockResolvedValue([]);

    await expect(loadCurrencyContext('c1')).resolves.toEqual({ referenceCurrency: null, rates: [] });
  });
});
