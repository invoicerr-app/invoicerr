/**
 * `CURRENCY_RATE_FAKE=1` (test env only) swaps the two real rate clients for these network-free,
 * deterministic fakes, branched on inside the runner's `runSweep`.
 *
 * A Cypress spec that lowers the sweep interval to observe an auto-derived pair would otherwise make
 * every run a live call to the real feed. Deliberately narrow: EUR-based rates for USD/GBP only, and
 * every other currency absent, the honest "not quoted" shape the real feed would also give), plus MAD,
 * which the ECB fake leaves uncovered so a spec can exercise the fallback path through the same flag.
 */

/** 1 EUR = this many units of `currency` - same shape `ecb-rates-client.ts#EcbDailyRates.rates`
 *  already holds, so `currency-rate-sweep.ts#computeCrossRate` (written against that shape) needs no
 *  special-casing to consume this fake instead of a real fetch. */
const FAKE_ECB_RATES: Readonly<Record<string, number>> = {
  USD: 1.0812,
  GBP: 0.8567,
};

/** Same shape as `FAKE_ECB_RATES` above, for `open-er-api-rates-client.ts`'s own EUR-based map - MAD
 *  is NOT in `FAKE_ECB_RATES`, which is what lets a spec reach this fallback at all. */
const FAKE_OPEN_ER_API_RATES: Readonly<Record<string, number>> = {
  MAD: 10.9,
};

/** Fake stand-in for `fetchEcbDailyRates` - pretends the ECB published its rates for TODAY (UTC),
 *  never a weekend/holiday carry-forward the real feed sometimes does: deterministic and sufficient
 *  for a Cypress assertion, which only needs a KNOWN `asOf`, not a realistic publication calendar. */
export function fakeFetchEcbDailyRates(): { referenceDate: string; rates: Map<string, number> } {
  return {
    referenceDate: new Date().toISOString().slice(0, 10),
    rates: new Map(Object.entries(FAKE_ECB_RATES)),
  };
}

/** Fake stand-in for `fetchOpenErApiRates`. */
export function fakeFetchOpenErApiRates(): { rates: Map<string, number> } {
  return { rates: new Map(Object.entries(FAKE_OPEN_ER_API_RATES)) };
}

export function currencyRateFakeEnabled(): boolean {
  return process.env.CURRENCY_RATE_FAKE === '1';
}
