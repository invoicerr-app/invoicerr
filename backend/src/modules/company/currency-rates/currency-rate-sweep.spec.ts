import { computeCrossRate, readCurrencyRateSweepIntervalMs } from './currency-rate-sweep';

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
