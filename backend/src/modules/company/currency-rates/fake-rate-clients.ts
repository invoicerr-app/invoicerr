/**
 * `CURRENCY_RATE_FAKE=1` (set only in a test env file, the SAME opt-in shape
 * `vat-currency/fake-rate-clients.ts`'s own `VAT_CURRENCY_RATE_FAKE` already holds for an unrelated
 * ECB call, and `clients.module.ts`'s `VAT_VALIDATION_FAKE`/`version.module.ts`'s
 * `GITHUB_RELEASES_FAKE` hold for theirs) swaps the two REAL rate clients this sweep calls
 * (`ecb-rates-client.ts`/`open-er-api-rates-client.ts`) for these network-free, deterministic
 * fakes, checked and branched on inside `currency-rate-sweep-runner.ts#runSweep` itself.
 *
 * Needed starting with issue #574: before it, this module's daily sweep only ever refreshed pairs a
 * company had ALREADY typed by hand, and its default interval (24h,
 * `readCurrencyRateSweepIntervalMs()`) meant no CI/Cypress run was ever long enough to see it fire
 * even once - so this module never needed a fake gate. A Cypress spec that LOWERS the interval to
 * observe the sweep auto-derive a pair (the same `*_SWEEP_INTERVAL_MS` pattern
 * `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS`/`DOCUMENT_CONFORMITY_SWEEP_INTERVAL_MS` already use for their
 * own sweeps) would otherwise make EVERY such run a LIVE call to the real ECB feed - exactly what
 * `vat-currency/fake-rate-clients.ts`'s own header already refuses for its unrelated call ("a CI job
 * must never depend on [a real feed] being up").
 *
 * Deliberately narrow, not a general mock: EUR-based rates for USD/GBP only on the ECB fake (every
 * OTHER currency returns `undefined`/absent, the honest "not quoted" shape the real feed would also
 * produce for an exotic code), plus ONE currency (MAD) the ECB fake deliberately leaves uncovered so
 * a spec can exercise the open.er-api.com FALLBACK path from the exact same gate - the same
 * "exercise both the happy path and the uncovered-currency path from one flag" discipline the
 * vat-currency fake already holds for its own two outcomes.
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
