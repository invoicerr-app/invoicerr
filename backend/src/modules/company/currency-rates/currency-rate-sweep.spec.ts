import {
  AUTOMATIC_RATE_SOURCES,
  ECB_SOURCE,
  EXCHANGERATE_API_SOURCE,
  computeCrossRate,
  deriveNeededCurrencyPairs,
  readCurrencyRateSweepIntervalMs,
} from './currency-rate-sweep';

// Same two ECB-shaped rates the ecb-rates-client.spec.ts fixture uses — 1 EUR = 1.0812 USD,
// 1 EUR = 0.8567 GBP. Expected quotients below were computed with the SAME `Decimal` class
// (`@prisma/client/runtime/client`), never typed by hand, to avoid a hand-rounded expectation
// silently drifting from what decimal.js itself would actually produce.
const ECB_RATES = new Map([
  ['USD', 1.0812],
  ['GBP', 0.8567],
]);

describe('computeCrossRate', () => {
  it('EUR -> USD reads the ECB rate directly', () => {
    expect(computeCrossRate('EUR', 'USD', ECB_RATES)).toBe('1.0812');
  });

  it('USD -> EUR is the exact reciprocal (1 / ecbRates.get("USD")), via Decimal division', () => {
    expect(computeCrossRate('USD', 'EUR', ECB_RATES)).toBe('0.92489826119126896041');
  });

  it('USD -> GBP crosses through EUR: ecbRates.get("GBP") / ecbRates.get("USD")', () => {
    expect(computeCrossRate('USD', 'GBP', ECB_RATES)).toBe('0.79236034036256011839');
  });

  it('GBP -> USD is the OTHER direction of the same cross, not the reciprocal of USD -> GBP', () => {
    expect(computeCrossRate('GBP', 'USD', ECB_RATES)).toBe('1.2620520602311194117');
  });

  it('same-currency is always the exact string "1", even for a currency off the ECB map', () => {
    expect(computeCrossRate('USD', 'USD', ECB_RATES)).toBe('1');
    expect(computeCrossRate('XYZ', 'XYZ', ECB_RATES)).toBe('1');
  });

  it('returns null (never a guess) when a currency the pair needs is missing from the ECB map', () => {
    expect(computeCrossRate('EUR', 'ZZZ', ECB_RATES)).toBeNull(); // to-leg missing
    expect(computeCrossRate('ZZZ', 'EUR', ECB_RATES)).toBeNull(); // from-leg missing
    expect(computeCrossRate('ZZZ', 'USD', ECB_RATES)).toBeNull(); // from-leg missing, cross case
    expect(computeCrossRate('USD', 'ZZZ', ECB_RATES)).toBeNull(); // to-leg missing, cross case
  });
});

describe('readCurrencyRateSweepIntervalMs', () => {
  const ORIGINAL = process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS;
    else process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS = ORIGINAL;
  });

  it('defaults to 24 hours (86_400_000ms) when unset', () => {
    delete process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS;
    expect(readCurrencyRateSweepIntervalMs()).toBe(86_400_000);
  });

  it('reads an override from the environment', () => {
    process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS = '120000';
    expect(readCurrencyRateSweepIntervalMs()).toBe(120000);
  });
});

describe('source constants', () => {
  it('the ECB and fallback sources are distinct strings — a reader must be able to tell them apart', () => {
    expect(ECB_SOURCE).toBe('ecb');
    expect(EXCHANGERATE_API_SOURCE).not.toBe(ECB_SOURCE);
  });

  it('AUTOMATIC_RATE_SOURCES contains both automatic sources and never "manual"', () => {
    expect(AUTOMATIC_RATE_SOURCES.has(ECB_SOURCE)).toBe(true);
    expect(AUTOMATIC_RATE_SOURCES.has(EXCHANGERATE_API_SOURCE)).toBe(true);
    expect(AUTOMATIC_RATE_SOURCES.has('manual')).toBe(false);
  });
});

// Issue #574 - "refresh the pairs a company actually uses". Every case here is pure, hand-built
// fixtures: no Prisma, no HTTP - `currency-rate-sweep-runner.spec.ts`'s own "scope (b)" tests prove
// the SAME rules through the runner's mocked grouped queries instead.
describe('deriveNeededCurrencyPairs', () => {
  const QUOTABLE = new Set(['EUR', 'USD', 'GBP']);

  it('a company with an invoice in USD and EUR as reference gets USD/EUR, without ever typing a rate', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: 'EUR' }],
      [{ companyId: 'company-1', currency: 'USD' }],
      [],
      QUOTABLE,
    );
    expect(pairs).toEqual([{ companyId: 'company-1', from: 'USD', to: 'EUR' }]);
  });

  it('a payment in GBP against a EUR invoice adds that pair, regardless of the reference currency', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: null }], // never opted into consolidation
      [],
      [{ companyId: 'company-1', paymentCurrency: 'GBP', documentCurrency: 'EUR' }],
      QUOTABLE,
    );
    expect(pairs).toEqual([{ companyId: 'company-1', from: 'GBP', to: 'EUR' }]);
  });

  it('no duplicate pair - a currency used by both a document and a client collapses to ONE pair', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: 'EUR' }],
      [
        { companyId: 'company-1', currency: 'USD' }, // from a document
        { companyId: 'company-1', currency: 'USD' }, // from a client
      ],
      [],
      QUOTABLE,
    );
    expect(pairs).toEqual([{ companyId: 'company-1', from: 'USD', to: 'EUR' }]);
  });

  it('no duplicate pair - the SAME pair reachable from usage AND a payment/document pair still collapses to one', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: 'EUR' }],
      [{ companyId: 'company-1', currency: 'USD' }],
      [{ companyId: 'company-1', paymentCurrency: 'USD', documentCurrency: 'EUR' }],
      QUOTABLE,
    );
    expect(pairs).toEqual([{ companyId: 'company-1', from: 'USD', to: 'EUR' }]);
  });

  it('no pair for a currency neither provider quotes', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: 'EUR' }],
      [{ companyId: 'company-1', currency: 'ZZZ' }], // not in QUOTABLE
      [{ companyId: 'company-1', paymentCurrency: 'ZZZ', documentCurrency: 'USD' }],
      QUOTABLE,
    );
    expect(pairs).toEqual([]);
  });

  it('no pair for an identity conversion - a currency already equal to the reference currency needs no rate', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: 'EUR' }],
      [{ companyId: 'company-1', currency: 'EUR' }],
      [{ companyId: 'company-1', paymentCurrency: 'EUR', documentCurrency: 'EUR' }],
      QUOTABLE,
    );
    expect(pairs).toEqual([]);
  });

  it('no pair at all for a company with no referenceCurrency and no recorded payment', () => {
    const pairs = deriveNeededCurrencyPairs(
      [{ companyId: 'company-1', referenceCurrency: null }],
      [{ companyId: 'company-1', currency: 'USD' }],
      [],
      QUOTABLE,
    );
    expect(pairs).toEqual([]);
  });

  it('keeps pairs from two different companies apart', () => {
    const pairs = deriveNeededCurrencyPairs(
      [
        { companyId: 'company-1', referenceCurrency: 'EUR' },
        { companyId: 'company-2', referenceCurrency: 'USD' },
      ],
      [
        { companyId: 'company-1', currency: 'USD' },
        { companyId: 'company-2', currency: 'GBP' },
      ],
      [],
      QUOTABLE,
    );
    expect(pairs).toEqual(
      expect.arrayContaining([
        { companyId: 'company-1', from: 'USD', to: 'EUR' },
        { companyId: 'company-2', from: 'GBP', to: 'USD' },
      ]),
    );
    expect(pairs).toHaveLength(2);
  });
});
