/**
 * The currency-rate sweep's own PURE decisions — split from currency-rate-sweep-runner.ts (the
 * Prisma/BullMQ-touching half) for the exact reason `conformity-sweep.ts` is split from its own
 * runner: cross-rate arithmetic is a plain function of data already in hand, testable without a
 * broker, an HTTP call, or a database (currency-rate-sweep.spec.ts).
 *
 * ## ONE sweep, not one repeatable per company — same reasoning as the other two sweeps
 *
 * Exactly one repeatable job (`CURRENCY_RATE_SWEEP_JOB_NAME`, registered by
 * `queue/document-queue.dispatcher.ts`'s own `registerCurrencyRateSweepRepeatable`, on
 * `readCurrencyRateSweepIntervalMs()`, default 24h) periodically fetches ONE global ECB feed and
 * refreshes every company's own currency pairs from it — the runner's own header
 * (currency-rate-sweep-runner.ts) explains why "the company's OWN existing pairs" is the honest
 * scope, not a scan of every document's currency.
 */

import { Prisma } from '../../../../prisma/generated/prisma/client';

export const CURRENCY_RATE_SWEEP_JOB_NAME = 'currency-rate-sweep';
export const CURRENCY_RATE_SWEEP_JOB_ID = 'currency-rate-sweep-singleton';

/** Default 24h (`86_400_000`ms) — the ECB publishes once a business day, around 16:00 CET, so
 *  sweeping more often than that would only ever re-observe the SAME reference date (a no-op,
 *  caught by the runner's own idempotency check) at the cost of an extra outbound HTTP call every
 *  time. Mirrors `conformity-sweep.ts#readConformitySweepIntervalMs`'s exact shape (env var, base-10
 *  `parseInt`, numeric fallback) — same convention, different cadence. */
export function readCurrencyRateSweepIntervalMs(): number {
  return parseInt(process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS ?? '86400000', 10);
}

/**
 * Turns the ECB's EUR-based feed into a rate for an ARBITRARY `(from, to)` pair — the one piece of
 * arithmetic this whole feature exists to get right.
 *
 * ## Why EUR-based, and what that implies
 * `ecbRates` holds ONLY "1 EUR = ecbRates.get(X) units of X" facts (`ecb-rates-client.ts`) — EUR
 * itself is never a key, by construction of the feed, so this function treats a EUR endpoint as an
 * implicit rate of exactly 1 rather than a map lookup that would always miss. From there:
 *   - `from === to` → `'1'`, always, even for a currency the ECB doesn't quote at all (an identity
 *     conversion needs no external fact to be true) — the SAME "no external rate needed" case
 *     `currency-rates.store.ts#createCurrencyRate` already refuses to even let a human enter.
 *   - `from === 'EUR'` → read `ecbRates.get(to)` directly: 1 EUR already equals that many `to`.
 *   - `to === 'EUR'` → the RECIPROCAL of `ecbRates.get(from)`: if 1 EUR = `r` units of `from`, then
 *     1 unit of `from` = `1/r` EUR.
 *   - otherwise (neither leg is EUR) → CROSS through EUR: 1 unit of `from` = `1/ecbRates.get(from)`
 *     EUR = `ecbRates.get(to)/ecbRates.get(from)` units of `to`.
 * Returns `null`, never a guessed value, the moment a currency THIS pair actually needs (excluding
 * an EUR leg, which is never looked up) is absent from `ecbRates` — an exotic manual pair the ECB
 * simply does not quote must be left to the next manual entry, never silently defaulted.
 *
 * ## Why `Decimal`, not `number` division
 * A stored `CurrencyRate.rate` is a Prisma `Decimal` column precisely because a rate multiplies
 * every converted amount downstream (`convert.ts#convertMinor`'s own header) — a JS float division
 * here would bake a binary-rounding error into that column PERMANENTLY, indistinguishable from a
 * genuine rate once persisted. `Prisma.Decimal` is imported from the generated client
 * (`../../../../prisma/generated/prisma/client`, the SAME relative-import convention every other
 * consumer of the generated client in this codebase uses — repo CLAUDE.md), NOT from
 * `@prisma/client/runtime/client` directly: that subpath's own `.d.ts` re-export of `Decimal`
 * type-checks fine INSIDE Prisma's generated files only because they carry `// @ts-nocheck`
 * (`internal/prismaNamespace.ts`) — importing it the same way from a normally-checked file in this
 * repo fails to compile (`TS2305: has no exported member 'Decimal'`), verified directly with `tsc`
 * against this exact `@prisma/client` version while writing this file. Going through the generated
 * client's own `Prisma` namespace re-export sidesteps that and matches how the rest of the app
 * already imports everything else from it. The STRING form (`Decimal#toString()`) is returned,
 * never a `number`, so the caller (`currency-rate-sweep-runner.ts`) can hand it to
 * `prisma.currencyRate.createMany` and have it land in the column bit-for-bit as computed, with no
 * second float round-trip in between.
 */
export function computeCrossRate(from: string, to: string, ecbRates: Map<string, number>): string | null {
  if (from === to) return '1';

  if (from === 'EUR') {
    const toRate = ecbRates.get(to);
    return toRate === undefined ? null : new Prisma.Decimal(toRate).toString();
  }

  if (to === 'EUR') {
    const fromRate = ecbRates.get(from);
    return fromRate === undefined ? null : new Prisma.Decimal(1).dividedBy(fromRate).toString();
  }

  const fromRate = ecbRates.get(from);
  const toRate = ecbRates.get(to);
  if (fromRate === undefined || toRate === undefined) return null;
  return new Prisma.Decimal(toRate).dividedBy(fromRate).toString();
}
