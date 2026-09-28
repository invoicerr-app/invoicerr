/**
 * `VAT_CURRENCY_RATE_FAKE=1` (set only in `backend/.env.test`, the SAME opt-in shape
 * `clients.module.ts`'s own `VAT_VALIDATION_FAKE` and `version.module.ts`'s own
 * `GITHUB_RELEASES_FAKE` already hold for their own outbound calls) swaps the two REAL rate clients
 * (`ecb-historical-rates-client.ts`/`nbp-rates-client.ts`) for these network-free, deterministic
 * fakes, checked, and branched on, inside `resolve-vat-currency.ts#resolveRate` itself.
 *
 * WHY a plain function-level branch here rather than a Nest DI factory provider (the shape those two
 * other fakes use): `resolveVatCurrencyConversion` is a PLAIN function, called from deep inside
 * `actions/invoice-actions.ts`'s "send" preflight, never behind a Nest injection token the way
 * `VatValidationClient`/`GithubReleaseClientPort` are, and the two REAL clients it calls
 * (`ecb-historical-rates-client.ts`/`nbp-rates-client.ts`) are themselves plain exported functions
 * with no DI of their own, the SAME "provider client is a plain async function" shape
 * `ecb-rates-client.ts`'s own header already holds for the (unrelated) daily-sweep ECB client.
 * Reaching for DI here would mean plumbing a token through `invoice-actions.ts`'s constructor for a
 * feature that is otherwise entirely free functions, a bigger, unrelated refactor for a test-only
 * concern.
 *
 * A CI job (or a developer running Cypress locally) must never depend on the real ECB/NBP APIs being
 * reachable, the exact same "a CI job must never depend on... VIES being up" principle
 * `clients.module.ts`'s own header states for VAT validation. Without this, EVERY e2e spec that sends
 * a foreign-currency FR/PL/IT invoice would be a live-network test, flaky by construction and unable
 * to run offline.
 *
 * Deliberately NARROW, not a general mock: only USD/GBP are faked at all (every OTHER currency
 * resolves to `undefined`, the SAME "not found" shape a real, honest gap would produce), and Poland's
 * own NBP fake refuses GBP specifically. This is what lets a Cypress spec exercise BOTH the happy
 * path (a USD invoice, a real converted figure to assert on) AND issue #517's own load-bearing
 * refusal ("a clear refusal when no NBP rate is available") from the SAME fake gate, with no separate
 * flag needed.
 */

/** EUR per 1 unit of `currency`, already in the direction `convert.ts#convertMinor` needs, the same
 *  as the REAL `ecb-historical-rates-client.ts#resolveEcbRateAsOf`'s own return shape. */
const FAKE_ECB_EUR_RATES: Readonly<Record<string, number>> = {
  USD: 0.85,
  GBP: 1.15,
};

/** PLN per 1 unit of `currency`. GBP is deliberately ABSENT, see this file's own header on why that
 *  is what lets the SAME fake gate exercise Poland's "no NBP rate available" refusal. */
const FAKE_NBP_PLN_RATES: Readonly<Record<string, number>> = {
  USD: 4.2,
};

function isoDateMinusOneDay(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Fake stand-in for `resolveEcbRateAsOf`: pretends the ECB published today's rate exactly on
 *  `dateIso` itself (never a weekend/holiday shift, unlike the real feed). Deterministic and
 *  sufficient for an e2e assertion, which only needs a KNOWN figure, not a realistic calendar. */
export function fakeResolveEcbRateAsOf(
  currency: string,
  dateIso: string,
): { rate: number; asOf: string } | undefined {
  const rate = FAKE_ECB_EUR_RATES[currency];
  if (rate === undefined) return undefined;
  return { rate, asOf: dateIso };
}

/** Fake stand-in for `resolveNbpRateBefore`: pretends NBP's last published business day was exactly
 *  one calendar day before `beforeDateIso`, the ordinary (no-weekend-in-between) case. */
export function fakeResolveNbpRateBefore(
  currency: string,
  beforeDateIso: string,
): { rate: number; asOf: string } | undefined {
  const rate = FAKE_NBP_PLN_RATES[currency];
  if (rate === undefined) return undefined;
  return { rate, asOf: isoDateMinusOneDay(beforeDateIso) };
}

export function vatCurrencyRateFakeEnabled(): boolean {
  return process.env.VAT_CURRENCY_RATE_FAKE === '1';
}
