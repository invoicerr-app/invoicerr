/**
 * A REAL fetch against open.er-api.com — the whole reason this file exists alongside
 * open-er-api-rates-client.spec.ts's mocked version.
 *
 * ## What a green run of THIS suite proves, and what it does NOT
 * A passing mocked suite (open-er-api-rates-client.spec.ts) proves the PARSER is correct against a
 * fixture shaped like the response captured on 2026-09-14 — it proves nothing about whether the URL
 * still resolves, still answers JSON, still uses the same field names, or still treats its OWN
 * errors as HTTP 200 the way it did when that fixture was captured (see the repo's own memory note
 * on KSeF mock tests for the identical false-confidence trap: a green mocked suite is not evidence
 * an external integration still works). ONLY this live suite exercises the real endpoint; a mocked
 * pass alone must never be cited as proof this fallback currently functions.
 * Conversely, even THIS suite passing does not prove `currency-rate-sweep-runner.ts` actually reaches
 * for this fallback correctly in the full pipeline — that composition is covered by
 * `currency-rate-sweep-runner.spec.ts`'s own (mocked) fallback tests, not here.
 *
 * Gated the same way every other `*.live.spec.ts` in this codebase is (`transports/live-gate.ts`):
 * silent no-op by default (CI, offline runs), only running when explicitly opted in — no credential
 * env vars are required (this hits a public, keyless feed), so the second `liveDescribe` argument is
 * omitted entirely, same as `ecb-rates-client.live.spec.ts`.
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
