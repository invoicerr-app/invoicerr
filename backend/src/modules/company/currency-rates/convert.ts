import { decimalsFor } from '@/utils/financial';

/**
 * Pure exchange-rate arithmetic and resolution — no Prisma here, so every rule below is directly
 * testable with hand-built fixtures, the same discipline documents/settlement/credits.ts already
 * holds for its own pure resolution step. `currency-rates.service.ts` is the only caller that talks
 * to the database; this file never does.
 */

/** The one shape both the resolver and `convertMinor`'s callers need about a stored rate — narrower
 *  than the full Prisma `CurrencyRate` row (id/companyId/createdAt play no part in the arithmetic),
 *  same "narrow input interface" convention as settlement/compute-settlement.ts's own
 *  `SettlementPaymentInput`. `rate` is a plain `number` here, not Prisma's `Decimal` — the boundary
 *  that converts one to the other lives in currency-rates.service.ts, once, rather than every pure
 *  function in this file having to import Prisma's runtime `Decimal` class just to read a value out
 *  of it. */
export interface CurrencyRateLike {
  from: string;
  to: string;
  rate: number;
  asOf: Date;
  source: string;
}

/**
 * The most recent `rate` row for the EXACT (from, to) pair whose `asOf` is not in the future —
 * "future" meaning strictly after `now`, so a rate dated to the current instant is already eligible.
 * Never falls back to a DIFFERENT pair, and never derives an inverse from (to, from): see this
 * module's own schema comment (`CurrencyRate`, schema.prisma) on why 1/rate is refused — a company
 * wanting both directions enters both. Returns `null` when no eligible row exists at all, which the
 * caller (currency-consolidation.ts) turns into a named warning, never a silent skip.
 */
export function resolveLatestRate(
  rates: readonly CurrencyRateLike[],
  from: string,
  to: string,
  now: Date,
): CurrencyRateLike | null {
  let latest: CurrencyRateLike | null = null;
  for (const candidate of rates) {
    if (candidate.from !== from || candidate.to !== to) continue;
    if (candidate.asOf.getTime() > now.getTime()) continue; // not eligible yet
    if (!latest || candidate.asOf.getTime() > latest.asOf.getTime()) {
      latest = candidate;
    }
  }
  return latest;
}

/**
 * Converts a MINOR-unit amount from one currency to another at `rate` (units of `to` per one unit
 * of `from`) — the one piece of arithmetic every consolidated aggregate in this codebase must route
 * through, never a naive `amountMinor * rate`.
 *
 * ## The decimals pitfall this function exists to avoid
 * Two currencies can subdivide differently (JPY has no minor unit at all — `decimalsFor('JPY') ===
 * 0` — while EUR has 2, per utils/financial.ts's own table). Multiplying MINOR units directly would
 * silently apply the rate to the wrong magnitude whenever `from` and `to` don't share the same
 * decimal count: 100 JPY (stored as minor amount `100`, since JPY has 0 decimals) at a rate of
 * 0.0065 would naively yield `0.65` — meaning 0.65 of a EURO-CENT, not 0.65 EUR — unless the
 * arithmetic first climbs back to MAJOR units (where "0.0065 EUR per JPY" actually means what it
 * says), applies the rate there, and only THEN redescends to the TARGET currency's own minor units.
 * `decimalsFor` (utils/financial.ts) is reused verbatim for both ends — not reimplemented here —
 * since it is already the one place this codebase keeps the ISO 4217 decimals table.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rate: number): number {
  const fromMajor = amountMinor / 10 ** decimalsFor(from);
  const toMajor = fromMajor * rate;
  return Math.round(toMajor * 10 ** decimalsFor(to));
}

/**
 * The "stop the silence" signal (currency-rate-sweep-runner.ts's own header): every DISTINCT
 * `(from, to)` pair among `rates` that has NEVER been written by one of `automaticSources`
 * (`currency-rate-sweep.ts`'s `AUTOMATIC_RATE_SOURCES` — the ECB, or the open.er-api.com fallback) —
 * only ever a manual entry.
 *
 * This is provable, not a guess: the daily sweep tries EVERY active pair against the ECB first, then
 * (only if that fails) the open.er-api.com fallback, before ever counting a pair as `skipped`
 * (`currency-rate-sweep-runner.ts#runSweep`) — so a pair with zero rows carrying an automatic source
 * has been tried and failed by BOTH, not merely "not swept yet". The one exception: a pair entered by
 * hand moments ago has not been through a sweep tick at all yet (default interval 24h), so it can
 * show here as a false positive until the next tick — the same "not confirmed automatically yet"
 * honesty `resolveLatestRate`'s own "no eligible row" case already accepts elsewhere in this file,
 * not a bug to fix here.
 *
 * Pure and DB-free like every other function in this file — `currency-rates.store.ts`'s
 * `listCurrencyRatePairsWithoutAutomaticRate` is the one caller that fetches `rates` and hands them
 * in, exactly the "store fetches, this file decides" split `resolveLatestRate` already holds.
 */
export function findPairsWithoutAutomaticRate(
  rates: readonly CurrencyRateLike[],
  automaticSources: ReadonlySet<string>,
): { from: string; to: string }[] {
  // NUL-joined key — same collision-free convention `currency-rate-sweep-runner.ts#pairKey` already
  // uses, since neither an ISO 4217 code nor (here) a currency pair can ever contain a NUL byte.
  const hasAutomaticRate = new Map<string, boolean>();
  const order: string[] = [];

  for (const r of rates) {
    const key = `${r.from}\0${r.to}`;
    if (!hasAutomaticRate.has(key)) {
      hasAutomaticRate.set(key, false);
      order.push(key);
    }
    if (automaticSources.has(r.source)) {
      hasAutomaticRate.set(key, true);
    }
  }

  return order
    .filter((key) => !hasAutomaticRate.get(key))
    .map((key) => {
      const [from, to] = key.split('\0');
      return { from, to };
    });
}
