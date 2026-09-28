import { afterEach, describe, expect, it } from 'vitest';

import {
  fakeResolveEcbRateAsOf,
  fakeResolveNbpRateBefore,
  vatCurrencyRateFakeEnabled,
} from './fake-rate-clients';

describe('fake-rate-clients', () => {
  it('fakeResolveEcbRateAsOf: USD/GBP resolve to a fixed, known EUR rate; anything else is undefined', () => {
    expect(fakeResolveEcbRateAsOf('USD', '2026-09-25')).toEqual({ rate: 0.85, asOf: '2026-09-25' });
    expect(fakeResolveEcbRateAsOf('GBP', '2026-09-25')).toEqual({ rate: 1.15, asOf: '2026-09-25' });
    expect(fakeResolveEcbRateAsOf('JPY', '2026-09-25')).toBeUndefined();
  });

  it('fakeResolveNbpRateBefore: USD resolves to a fixed PLN rate, dated the day before; GBP is deliberately absent (the refusal fixture)', () => {
    expect(fakeResolveNbpRateBefore('USD', '2026-09-25')).toEqual({ rate: 4.2, asOf: '2026-09-24' });
    expect(fakeResolveNbpRateBefore('GBP', '2026-09-25')).toBeUndefined();
  });
});

describe('vatCurrencyRateFakeEnabled', () => {
  afterEach(() => {
    delete process.env.VAT_CURRENCY_RATE_FAKE;
  });

  it('is true only when the env var is exactly "1"', () => {
    process.env.VAT_CURRENCY_RATE_FAKE = '1';
    expect(vatCurrencyRateFakeEnabled()).toBe(true);

    process.env.VAT_CURRENCY_RATE_FAKE = 'true';
    expect(vatCurrencyRateFakeEnabled()).toBe(false);

    delete process.env.VAT_CURRENCY_RATE_FAKE;
    expect(vatCurrencyRateFakeEnabled()).toBe(false);
  });
});
