import { afterEach, describe, expect, it } from 'vitest';

import {
  currencyRateFakeEnabled,
  fakeFetchEcbDailyRates,
  fakeFetchOpenErApiRates,
} from './fake-rate-clients';

describe('fakeFetchEcbDailyRates', () => {
  it('quotes USD and GBP against EUR, dated today (UTC)', () => {
    const { referenceDate, rates } = fakeFetchEcbDailyRates();
    expect(referenceDate).toBe(new Date().toISOString().slice(0, 10));
    expect(rates.get('USD')).toBe(1.0812);
    expect(rates.get('GBP')).toBe(0.8567);
  });

  it('does not quote MAD - the fallback path needs a currency the ECB fake leaves uncovered', () => {
    expect(fakeFetchEcbDailyRates().rates.has('MAD')).toBe(false);
  });
});

describe('fakeFetchOpenErApiRates', () => {
  it('quotes MAD against EUR - the one currency the ECB fake above deliberately omits', () => {
    expect(fakeFetchOpenErApiRates().rates.get('MAD')).toBe(10.9);
  });
});

describe('currencyRateFakeEnabled', () => {
  afterEach(() => {
    delete process.env.CURRENCY_RATE_FAKE;
  });

  it('is true only when the env var is exactly "1"', () => {
    process.env.CURRENCY_RATE_FAKE = '1';
    expect(currencyRateFakeEnabled()).toBe(true);

    process.env.CURRENCY_RATE_FAKE = 'true';
    expect(currencyRateFakeEnabled()).toBe(false);

    delete process.env.CURRENCY_RATE_FAKE;
    expect(currencyRateFakeEnabled()).toBe(false);
  });
});
