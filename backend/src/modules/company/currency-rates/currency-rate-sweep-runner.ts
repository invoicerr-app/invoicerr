/**
 * The Prisma/queue-touching half of the currency-rate sweep — `currency-rate-sweep.ts` holds the
 * pure decisions (`computeCrossRate`, the job constants, the interval reader); this class is what
 * actually calls the ECB feed and reads/writes `CurrencyRate` rows, the same "pure core, thin
 * persistence shell" split `conformity-sweep-runner.ts` already holds for its own sweep.
 *
 * Consumed by `queue/processors/document-action.processor.ts`, exactly like the conformity and
 * schedule sweeps — same queue (`Q_DOCUMENT_ACTION`), distinguished by `job.name`.
 *
 * ## Scope: only pairs a company ALREADY entered by hand
 * "Refresh the rates you used to type by hand" is read literally: for each company, this sweep
 * finds the DISTINCT `(from, to)` pairs already present among that company's own `CurrencyRate`
 * rows (of ANY source — a pair first entered manually is still a pair worth refreshing daily) and
 * recomputes today's rate for each. It deliberately does NOT scan `DocumentInstance`/`Client`
 * currencies to invent pairs nobody asked for — a company that has never entered a manual rate has
 * nothing to refresh, and gets no ECB rows, which is the CORRECT outcome, not a gap. Auto-discovering
 * pairs from actual document/client currency usage is a deliberate follow-up, not in scope here.
 *
 * ## Idempotency — there is no DB unique constraint on `CurrencyRate`
 * The schema intentionally carries none (see that model's own schema.prisma comment on why a rate
 * row is just a dated fact, never upserted) — a rerun of this sweep on the SAME reference date must
 * still be a no-op, so this class enforces it in application code: before inserting, it fetches
 * every row ALREADY stamped with today's `asOf` and an AUTOMATIC source (`AUTOMATIC_RATE_SOURCES` —
 * ECB or the fallback below; `'manual'` rows are never dedup targets) and skips any pair already
 * covered, the same "read once, filter in memory" shape
 * `conformity/authority-events.persistence.ts`'s own dedup checks use rather than one query per
 * candidate.
 *
 * ## The open.er-api.com fallback — fired lazily, only when the ECB actually leaves a gap
 * The ECB feed quotes ~29 currencies; this product's `Currency` enum (schema.prisma) accepts 171, so
 * a company billing in e.g. MAD/AED/SAR previously had NO conversion at all — `computeCrossRate`
 * returned `null` and the pair was silently folded into `skipped`. For each active pair, this runner
 * tries the ECB map FIRST and ONLY reaches for `open-er-api-rates-client.ts`'s own map when that
 * comes back `null` — never blending the two (`currency-rate-sweep.ts#computeCrossRate`'s own header
 * explains why a blended rate must never be stamped as either source's alone). The fallback fetch
 * itself is LAZY (`getFallbackRates` below, called at most once per pass): a company whose active
 * pairs are all ECB-covered — the common case (EUR/USD/GBP…) — triggers zero calls to
 * open.er-api.com, so its sweep behaves EXACTLY as it did before this fallback existed. A pair that
 * still comes back `null` from BOTH sources is `skipped`, same as before — surfaced separately via
 * `convert.ts#findPairsWithoutAutomaticRate` / `currency-rates.store.ts`'s own
 * `listCurrencyRatePairsWithoutAutomaticRate`, not left as a silent counter alone.
 */
import { Injectable, Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import {
  AUTOMATIC_RATE_SOURCES,
  ECB_SOURCE,
  EXCHANGERATE_API_SOURCE,
  computeCrossRate,
} from './currency-rate-sweep';
import { fetchEcbDailyRates } from './ecb-rates-client';
import { fetchOpenErApiRates } from './open-er-api-rates-client';

export interface RunCurrencyRateSweepResult {
  /** `false` only when the ECB fetch itself failed — every other outcome (including "nothing to
   *  refresh because no company has ever entered a manual rate") is a successful, empty pass. */
  ok: boolean;
  /** How many DISTINCT companies had at least one active `(from, to)` pair this pass looked at. */
  companiesProcessed: number;
  /** How many NEW `CurrencyRate` rows this pass actually wrote. */
  inserted: number;
  /** How many active pairs were looked at but NOT written — already refreshed today (idempotency)
   *  OR a currency NEITHER the ECB feed nor the open.er-api.com fallback quotes.
   *  `currency-rate-sweep-runner.spec.ts` proves all three reasons (idempotency, ECB-only miss now
   *  covered by the fallback, and a miss by both) land here or in `inserted`, never as a thrown
   *  error. A pair still `skipped` for the "neither source covers it" reason is surfaced separately —
   *  see `convert.ts#findPairsWithoutAutomaticRate` — never left as just this counter. */
  skipped: number;
  /** Set only when `ok` is `false` — the ECB fetch's own error message, for the log line and for a
   *  test to assert on without parsing a log. */
  error?: string;
}

/** One row `findActiveCurrencyRatePairs` returns — a company's own distinct pair, source-agnostic
 *  (a pair first entered manually is exactly as "active" as one an earlier ECB pass already
 *  refreshed once). */
interface ActiveCurrencyRatePair {
  companyId: string;
  from: string;
  to: string;
}

/** Every DISTINCT `(companyId, from, to)` combination that exists among ALL companies' `CurrencyRate`
 *  rows, in ONE query — never one query per company: with dozens/hundreds of companies this sweep
 *  runs against, N+1 company-scoped queries would turn a once-a-day job into the slowest thing this
 *  worker does for no benefit, since Postgres can already group across the whole table directly. */
async function findActiveCurrencyRatePairs(): Promise<ActiveCurrencyRatePair[]> {
  return prisma.currencyRate.findMany({
    distinct: ['companyId', 'from', 'to'],
    select: { companyId: true, from: true, to: true },
  });
}

/** A stable, collision-free key for the in-memory idempotency Set below — a NUL byte (`\0`) can never appear
 *  in a companyId (cuid) or an ISO 4217 code, so three arbitrary strings joined by it never collide
 *  with a different triple the way a bare `${a}-${b}-${c}` could if a value itself contained `-`. */
function pairKey(companyId: string, from: string, to: string): string {
  return `${companyId}\0${from}\0${to}`;
}

/** Every `(companyId, from, to)` already covered by an AUTOMATIC-source row (ECB or the
 *  open.er-api.com fallback — `AUTOMATIC_RATE_SOURCES`) dated `asOf` — one query, reused as an
 *  in-memory Set for every candidate pair below, the same "one read, filter in memory" discipline
 *  `findActiveCurrencyRatePairs`'s own header already applies for the candidate list itself. A pair
 *  only ever gets ONE automatic row per `asOf` regardless of which source produced it (a day where
 *  the ECB covers a pair never ALSO gets a fallback row for the same day), so checking both sources
 *  in one query is enough — no need to distinguish which one already ran. */
async function findAlreadyRefreshedPairKeys(asOf: Date): Promise<Set<string>> {
  const rows = await prisma.currencyRate.findMany({
    where: { source: { in: Array.from(AUTOMATIC_RATE_SOURCES) }, asOf },
    select: { companyId: true, from: true, to: true },
  });
  return new Set(rows.map((row) => pairKey(row.companyId, row.from, row.to)));
}

@Injectable()
export class CurrencyRateSweepRunner {
  private readonly logger = new Logger(CurrencyRateSweepRunner.name);

  /**
   * One sweep pass. NEVER throws — a failed ECB fetch (the feed is down, DNS hiccups, the 10s
   * timeout in `ecb-rates-client.ts` trips) is logged and reported as `{ ok: false }`, exactly the
   * "a handler never kills the worker process" rule `conformity-sweep-runner.ts`'s own header states
   * explicitly for its own poll failures: the NEXT scheduled sweep tick, a day away by default, is
   * already the natural retry for "the feed could not be reached this time".
   */
  async runSweep(): Promise<RunCurrencyRateSweepResult> {
    let referenceDate: string;
    let ecbRates: Map<string, number>;
    try {
      ({ referenceDate, rates: ecbRates } = await fetchEcbDailyRates());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Currency-rate sweep could not fetch the ECB daily feed — skipping this pass: ${message}`,
      );
      return { ok: false, companiesProcessed: 0, inserted: 0, skipped: 0, error: message };
    }

    // Midnight UTC of the ECB's own reference date — a plain calendar day, never "the instant this
    // pass happened to run" (`new Date()`), so re-running the sweep later the SAME day recomputes
    // the SAME `asOf` and is caught by `findAlreadyRefreshedPairKeys` below, not double-dated.
    const asOf = new Date(`${referenceDate}T00:00:00.000Z`);

    const [pairs, alreadyRefreshed] = await Promise.all([
      findActiveCurrencyRatePairs(),
      findAlreadyRefreshedPairKeys(asOf),
    ]);

    const companiesProcessed = new Set(pairs.map((pair) => pair.companyId)).size;
    const rowsToInsert: {
      companyId: string;
      from: string;
      to: string;
      rate: string;
      asOf: Date;
      source: string;
    }[] = [];
    let skipped = 0;
    let viaFallback = 0;

    // Lazily fetched, at most ONCE per pass — see this class's own header ("fired lazily") for why: a
    // company whose active pairs are all ECB-covered never triggers this call at all.
    let fallbackRates: Map<string, number> | null | undefined; // undefined = not attempted yet
    const getFallbackRates = async (): Promise<Map<string, number> | null> => {
      if (fallbackRates !== undefined) return fallbackRates;
      try {
        fallbackRates = (await fetchOpenErApiRates()).rates;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Currency-rate sweep could not fetch the open.er-api.com fallback feed — pairs the ECB ` +
            `doesn't cover stay unresolved this pass: ${message}`,
        );
        fallbackRates = null;
      }
      return fallbackRates;
    };

    for (const pair of pairs) {
      if (alreadyRefreshed.has(pairKey(pair.companyId, pair.from, pair.to))) {
        skipped++; // idempotency: this pair was already refreshed for this exact reference date
        continue;
      }

      let rate = computeCrossRate(pair.from, pair.to, ecbRates);
      let source = ECB_SOURCE;

      if (rate === null) {
        // The ECB doesn't quote a currency this pair needs — try open.er-api.com's OWN map, entirely
        // on its own (never mixed with the ECB map above: `computeCrossRate` resolves the WHOLE pair
        // from whichever single map it's given, so a hit here is 100% fallback-sourced, never blended).
        const fallback = await getFallbackRates();
        if (fallback) {
          rate = computeCrossRate(pair.from, pair.to, fallback);
          source = EXCHANGERATE_API_SOURCE;
        }
      }

      if (rate === null) {
        skipped++; // neither source covers this pair — never insert a guess
        continue;
      }

      if (source === EXCHANGERATE_API_SOURCE) viaFallback++;

      rowsToInsert.push({
        companyId: pair.companyId,
        from: pair.from,
        to: pair.to,
        rate,
        asOf,
        source,
      });
    }

    if (rowsToInsert.length > 0) {
      await prisma.currencyRate.createMany({ data: rowsToInsert });
    }

    this.logger.log(
      `Currency-rate sweep (asOf ${referenceDate}): ${companiesProcessed} compan${companiesProcessed === 1 ? 'y' : 'ies'}, ` +
        `${rowsToInsert.length} row(s) inserted (${viaFallback} via the open.er-api.com fallback), ` +
        `${skipped} pair(s) skipped.`,
    );

    return { ok: true, companiesProcessed, inserted: rowsToInsert.length, skipped };
  }
}
