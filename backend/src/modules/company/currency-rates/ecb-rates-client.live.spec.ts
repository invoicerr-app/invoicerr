/**
 * A REAL fetch against the ECB's own feed — the whole reason this file exists alongside
 * ecb-rates-client.spec.ts's mocked version: a green mocked suite proves the PARSER is correct, not
 * that the URL still resolves, still answers XML, or still uses the same element/attribute shape
 * (see the repo's own memory note on KSeF mock tests for the identical false-confidence trap).
 *
 * Gated the same way every other `*.live.spec.ts` in this codebase is (`transports/live-gate.ts`):
 * silent no-op by default (CI, offline runs), only running when explicitly opted in — no credential
 * env vars are required (this hits a public, keyless feed), so the second `liveDescribe` argument is
 * omitted entirely.
 *
 *   ECB_LIVE=1 npx jest ecb-rates-client.live --no-coverage
 */
import { liveDescribe } from '../../documents/transports/live-gate';
import { fetchEcbDailyRates } from './ecb-rates-client';

const describeLive = liveDescribe('ECB_LIVE');

describeLive('ECB daily rates feed — live fetch', () => {
  jest.setTimeout(15_000);

  it('returns a well-formed reference date and a plausible EUR -> USD rate', async () => {
    const { referenceDate, rates } = await fetchEcbDailyRates();

    expect(referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const usd = rates.get('USD');
    expect(usd).toBeDefined();
    expect(Number.isFinite(usd)).toBe(true);
    // EUR/USD has stayed within this band for decades — a value outside it means the feed's shape
    // changed (wrong attribute picked up, wrong element) far more likely than a real market move.
    expect(usd as number).toBeGreaterThan(0.5);
    expect(usd as number).toBeLessThan(2.5);

    // EUR is never a key of its own — proves the parser didn't accidentally pick up a stray Cube.
    expect(rates.has('EUR')).toBe(false);
    expect(rates.size).toBeGreaterThan(10); // the real feed quotes ~30 currencies
  });
});
