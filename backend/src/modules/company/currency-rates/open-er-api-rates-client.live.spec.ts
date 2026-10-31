/**
 * A real fetch against open.er-api.com, alongside the mocked spec.
 *
 * The mocked suite proves the parser against a fixture only, not that the URL still resolves, answers
 * JSON with the same field names, or still reports its own errors as HTTP 200. Only this suite
 * exercises the endpoint, so a mocked pass alone must never be cited as proof the fallback works. It
 * still does not prove the runner reaches the fallback correctly, which the runner's mock tests cover.
 *
 * Silent no-op unless `OPEN_ER_API_LIVE=1`, like every other live spec: no credentials, since the feed
 * is public. Run with:
 *
 *   OPEN_ER_API_LIVE=1 npx vitest run src/modules/company/currency-rates/open-er-api-rates-client.live.spec.ts
 */

import { vi } from 'vitest';

import { liveDescribe } from '../../documents/transports/live-gate';
import { fetchOpenErApiRates } from './open-er-api-rates-client';

const describeLive = liveDescribe('OPEN_ER_API_LIVE');

describeLive('open.er-api.com rates feed — live fetch', () => {
  vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

  it('returns a broad EUR-based rate table including a currency the ECB never quotes (MAD)', async () => {
    const { rates } = await fetchOpenErApiRates();

    const usd = rates.get('USD');
    expect(usd).toBeDefined();
    expect(Number.isFinite(usd)).toBe(true);
    // EUR/USD has stayed within this band for decades — a value outside it means the feed's shape
    // changed far more likely than a real market move (same band ecb-rates-client.live.spec.ts uses).
    expect(usd as number).toBeGreaterThan(0.5);
    expect(usd as number).toBeLessThan(2.5);

    // MAD (Moroccan dirham) is the concrete example this whole fallback exists for — the ECB's daily
    // feed has never quoted it. Proving it resolves HERE, live, is what a mocked pass cannot prove.
    const mad = rates.get('MAD');
    expect(mad).toBeDefined();
    expect(Number.isFinite(mad)).toBe(true);
    expect(mad as number).toBeGreaterThan(0);

    // EUR is never a key of its own — proves the parser didn't accidentally keep the base entry.
    expect(rates.has('EUR')).toBe(false);
    expect(rates.size).toBeGreaterThan(100); // the real feed quotes well over 100 currencies
  });
});
