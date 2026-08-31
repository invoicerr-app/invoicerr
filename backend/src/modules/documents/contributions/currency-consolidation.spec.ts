import { CurrencyRateLike } from '../../company/currency-rates/convert';
import * as currencyRatesStore from '../../company/currency-rates/currency-rates.store';
import { consolidateByCurrency, loadCurrencyContext } from './currency-consolidation';

// Only the two DB-touching reads are mocked — `toCurrencyRateLikes` stays the REAL pure mapper
// (same "mock only what touches Prisma" discipline invoice-contributions.spec.ts already applies to
// settlement/credits.ts's own `listCreditNotes`).
jest.mock('../../company/currency-rates/currency-rates.store', () => {
  const actual = jest.requireActual('../../company/currency-rates/currency-rates.store');
  return { ...actual, getReferenceCurrency: jest.fn(), listCurrencyRates: jest.fn() };
});

const getReferenceCurrency = currencyRatesStore.getReferenceCurrency as jest.Mock;
const listCurrencyRates = currencyRatesStore.listCurrencyRates as jest.Mock;

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
