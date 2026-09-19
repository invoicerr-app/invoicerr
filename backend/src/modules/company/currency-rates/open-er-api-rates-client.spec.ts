import { vi } from 'vitest';

import { fetchOpenErApiRates } from './open-er-api-rates-client';

/** A trimmed but structurally real fixture — the SAME top-level shape a real
 *  `GET https://open.er-api.com/v6/latest/EUR` returns (verified live, 2026-09-14), just with three
 *  currencies instead of the ~160 the live feed carries. */
const FIXTURE_BODY = {
  result: 'success',
  provider: 'https://www.exchangerate-api.com',
  documentation: 'https://www.exchangerate-api.com/docs/free',
  terms_of_use: 'https://www.exchangerate-api.com/terms',
  time_last_update_utc: 'Mon, 14 Sep 2026 00:02:31 +0000',
  time_next_update_utc: 'Tue, 15 Sep 2026 00:22:21 +0000',
  base_code: 'EUR',
  rates: { EUR: 1, USD: 1.159656, MAD: 10.90371, GBP: 0.857617 },
};

function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('fetchOpenErApiRates', () => {
  afterEach(() => vi.resetAllMocks());

  it('parses every currency/rate pair from the fixture, EUR excluded', async () => {
    mockFetchOnce(FIXTURE_BODY);

    const { rates } = await fetchOpenErApiRates();

    expect(rates.get('USD')).toBe(1.159656);
    expect(rates.get('MAD')).toBe(10.90371); // the ECB does not quote MAD at all — the whole point of this fallback
    expect(rates.get('GBP')).toBe(0.857617);
    expect(rates.size).toBe(3);
    // EUR is the implicit base — never a key of its own, same convention ecb-rates-client.ts holds,
    // and computeCrossRate (currency-rate-sweep.ts) never looks it up as one either way.
    expect(rates.has('EUR')).toBe(false);
  });

  it('throws when the HTTP response itself is not ok', async () => {
    mockFetchOnce({}, false, 503);

    await expect(fetchOpenErApiRates()).rejects.toThrow(/HTTP 503/);
  });

  it("throws on the feed's own error result even though HTTP itself is 200 — verified live shape", async () => {
    mockFetchOnce({ result: 'error', 'error-type': 'unsupported-code' });

    await expect(fetchOpenErApiRates()).rejects.toThrow(/unsupported-code/);
  });

  it('throws when base_code is not EUR — guards the EUR-based composition math downstream', async () => {
    mockFetchOnce({ result: 'success', base_code: 'USD', rates: { EUR: 0.86 } });

    await expect(fetchOpenErApiRates()).rejects.toThrow(/base_code/);
  });

  it('throws when the "rates" object is missing', async () => {
    mockFetchOnce({ result: 'success', base_code: 'EUR' });

    await expect(fetchOpenErApiRates()).rejects.toThrow(/no "rates" object/);
  });

  it('throws when "rates" carries nothing usable besides the base currency itself', async () => {
    mockFetchOnce({ result: 'success', base_code: 'EUR', rates: { EUR: 1 } });

    await expect(fetchOpenErApiRates()).rejects.toThrow(/no usable currency rates/);
  });
});
