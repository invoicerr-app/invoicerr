/**
 * The persistence half of the currency-rate sweep: calls the feeds and reads/writes `CurrencyRate`
 * rows, while `currency-rate-sweep.ts` holds the pure decisions. Run from the document-action queue,
 * distinguished by job name.
 *
 * Scope: the union of the pairs a company already entered by hand and the pairs its documents,
 * clients and payments actually need, derived with one grouped query per fact over the whole table
 * rather than one query per company. Both lists are merged before processing, so a pair in both is
 * refreshed once.
 *
 * Idempotency: `CurrencyRate` has no unique constraint (a rate is a dated fact), so a rerun on the
 * same reference date skips pairs already stamped today with an automatic source.
 *
 * The open.er-api.com fallback is reached only when the ECB map returns null for a pair, and fetched
 * lazily at most once per pass, so an instance on ECB-covered currencies makes no fallback call.
 */
import { Injectable, Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import {
  AUTOMATIC_RATE_SOURCES,
  CompanyPaymentDocumentCurrencyPair,
  CompanyReferenceCurrency,
  CompanyUsedCurrency,
  ECB_SOURCE,
  EXCHANGERATE_API_SOURCE,
  NeededCurrencyPair,
  computeCrossRate,
  deriveNeededCurrencyPairs,
} from './currency-rate-sweep';
import { fetchEcbDailyRates } from './ecb-rates-client';
import {
  currencyRateFakeEnabled,
  fakeFetchEcbDailyRates,
  fakeFetchOpenErApiRates,
} from './fake-rate-clients';
import { fetchOpenErApiRates } from './open-er-api-rates-client';

export interface RunCurrencyRateSweepResult {
  /** `false` only when the ECB fetch itself failed — every other outcome (including "nothing to
   *  refresh because no company has ever entered a manual rate") is a successful, empty pass. */
  ok: boolean;
  /** How many distinct companies had at least one pair this pass looked at, whether entered by hand or
   *  needed by a document, client or payment. */
  companiesProcessed: number;
  /** How many NEW `CurrencyRate` rows this pass actually wrote. */
  inserted: number;
  /** Pairs looked at but not written: already refreshed today, or quoted by neither source. A pair
   *  neither source covers is surfaced separately by `convert.ts#findPairsWithoutAutomaticRate`. */
  skipped: number;
  /** Set only when `ok` is `false` — the ECB fetch's own error message, for the log line and for a
   *  test to assert on without parsing a log. */
  error?: string;
}

/** One row `findActiveCurrencyRatePairs` returns: a company's own distinct pair, whatever its source. */
interface ActiveCurrencyRatePair {
  companyId: string;
  from: string;
  to: string;
}

/** Every distinct (companyId, from, to) across all companies' rates, in one query: grouping across the
 *  whole table beats one company-scoped query per tenant on a daily job. */
async function findActiveCurrencyRatePairs(): Promise<ActiveCurrencyRatePair[]> {
  return prisma.currencyRate.findMany({
    distinct: ['companyId', 'from', 'to'],
    select: { companyId: true, from: true, to: true },
  });
}

/** Every company's reference currency (null when it never opted into consolidation), the target
 *  `deriveNeededCurrencyPairs` pairs each used currency against. One query, not per company. */
async function findCompanyReferenceCurrencies(): Promise<CompanyReferenceCurrency[]> {
  const companies = await prisma.company.findMany({ select: { id: true, referenceCurrency: true } });
  return companies.map((c) => ({ companyId: c.id, referenceCurrency: c.referenceCurrency }));
}

/** One raw `$queryRaw` row from the JSON-grouping queries: a bare currency string, not the enum, since a
 *  document's currency lives inside its JSONB `data`. */
interface RawCompanyCurrencyRow {
  companyId: string;
  currency: string;
}

/**
 * Every distinct (companyId, currency) used by a company's documents, clients or payments, from three
 * grouped queries over whole tables. Documents need raw SQL because the currency lives in JSONB;
 * clients and payments have typed columns and use `groupBy`. Duplicates across the three are left to
 * `deriveNeededCurrencyPairs`.
 */
async function findUsedCurrenciesByCompany(): Promise<CompanyUsedCurrency[]> {
  const [documentRows, clientRows, paymentRows] = await Promise.all([
    prisma.$queryRaw<RawCompanyCurrencyRow[]>`
      SELECT "companyId" AS "companyId", (data ->> 'currency') AS "currency"
      FROM "DocumentInstance"
      WHERE data ->> 'currency' IS NOT NULL AND data ->> 'currency' <> ''
      GROUP BY "companyId", (data ->> 'currency')
    `,
    prisma.client.groupBy({ by: ['companyId', 'currency'], where: { currency: { not: null } } }),
    prisma.documentPayment.groupBy({ by: ['companyId', 'currency'] }),
  ]);

  return [
    ...documentRows,
    ...clientRows
      .filter((row): row is typeof row & { currency: string } => row.currency !== null)
      .map((row) => ({ companyId: row.companyId, currency: row.currency as string })),
    ...paymentRows.map((row) => ({ companyId: row.companyId, currency: row.currency })),
  ];
}

/**
 * Every distinct payment-to-document currency pair actually recorded, from one grouped query joining
 * `DocumentPayment` to its document (whose currency is JSONB, hence raw SQL). This is the pair a
 * payment converts into the invoice it settles, not the company's reference currency.
 */
async function findPaymentDocumentCurrencyPairs(): Promise<CompanyPaymentDocumentCurrencyPair[]> {
  return prisma.$queryRaw<CompanyPaymentDocumentCurrencyPair[]>`
    SELECT dp."companyId" AS "companyId", dp."currency" AS "paymentCurrency", (di.data ->> 'currency') AS "documentCurrency"
    FROM "DocumentPayment" dp
    JOIN "DocumentInstance" di ON di.id = dp."documentId"
    WHERE di.data ->> 'currency' IS NOT NULL AND di.data ->> 'currency' <> ''
    GROUP BY dp."companyId", dp."currency", (di.data ->> 'currency')
  `;
}

/** Folds the manual pairs and the needed pairs into one de-duplicated list: the idempotency check only
 *  catches rows committed by a previous pass, not two candidates in the same one. */
function mergeAndDedupe(
  active: readonly ActiveCurrencyRatePair[],
  needed: readonly NeededCurrencyPair[],
): ActiveCurrencyRatePair[] {
  const seen = new Set<string>();
  const merged: ActiveCurrencyRatePair[] = [];
  for (const pair of [...active, ...needed]) {
    const key = pairKey(pair.companyId, pair.from, pair.to);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ companyId: pair.companyId, from: pair.from, to: pair.to });
  }
  return merged;
}

/** Key for the in-memory idempotency set. A NUL byte cannot appear in a cuid or a currency code, so the
 *  triple cannot collide with another one. */
function pairKey(companyId: string, from: string, to: string): string {
  return `${companyId}\0${from}\0${to}`;
}

/** Every pair already covered by an automatic-source row for `asOf`, read once and filtered in memory.
 *  A pair gets at most one automatic row per day, whatever its source. */
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
   * One sweep pass. Never throws: a failed feed fetch is logged and reported as `{ ok: false }`, since
   * the next scheduled tick is the natural retry.
   */
  async runSweep(): Promise<RunCurrencyRateSweepResult> {
    let referenceDate: string;
    let ecbRates: Map<string, number>;
    try {
      // Test env only: a deterministic, network-free fake instead of the real feed.
      ({ referenceDate, rates: ecbRates } = currencyRateFakeEnabled()
        ? fakeFetchEcbDailyRates()
        : await fetchEcbDailyRates());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Currency-rate sweep could not fetch the ECB daily feed — skipping this pass: ${message}`,
      );
      return { ok: false, companiesProcessed: 0, inserted: 0, skipped: 0, error: message };
    }

    // Midnight UTC of the feed's reference date, not the instant this pass ran, so a rerun the same day
    // computes the same `asOf` and is caught by the idempotency set.
    const asOf = new Date(`${referenceDate}T00:00:00.000Z`);

    const [activePairs, alreadyRefreshed, referenceCurrencies, usedCurrencies, paymentDocumentPairs] =
      await Promise.all([
        findActiveCurrencyRatePairs(),
        findAlreadyRefreshedPairKeys(asOf),
        findCompanyReferenceCurrencies(),
        findUsedCurrenciesByCompany(),
        findPaymentDocumentCurrencyPairs(),
      ]);

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

    // Lazily fetched, at most once per pass: a company on ECB-covered pairs never triggers it.
    let fallbackRates: Map<string, number> | null | undefined; // undefined = not attempted yet
    const getFallbackRates = async (): Promise<Map<string, number> | null> => {
      if (fallbackRates !== undefined) return fallbackRates;
      try {
        fallbackRates = (currencyRateFakeEnabled() ? fakeFetchOpenErApiRates() : await fetchOpenErApiRates())
          .rates;
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

    // Which used currencies either source can quote. EUR is free, and the fallback is only fetched
    // when a used currency falls outside the ECB map, memoized across the pass.
    const ecbCurrencies = new Set<string>([...ecbRates.keys(), 'EUR']);
    const usageCurrencies = new Set<string>([
      ...usedCurrencies.map((u) => u.currency),
      ...paymentDocumentPairs.flatMap((p) => [p.paymentCurrency, p.documentCurrency]),
    ]);
    const needsFallbackForQuotability = [...usageCurrencies].some((c) => !ecbCurrencies.has(c));
    const fallbackForQuotability = needsFallbackForQuotability ? await getFallbackRates() : null;
    const quotableCurrencies = new Set<string>([
      ...ecbCurrencies,
      ...(fallbackForQuotability ? fallbackForQuotability.keys() : []),
    ]);

    const neededPairs = deriveNeededCurrencyPairs(
      referenceCurrencies,
      usedCurrencies,
      paymentDocumentPairs,
      quotableCurrencies,
    );
    const pairs = mergeAndDedupe(activePairs, neededPairs);
    const companiesProcessed = new Set(pairs.map((pair) => pair.companyId)).size;

    for (const pair of pairs) {
      if (alreadyRefreshed.has(pairKey(pair.companyId, pair.from, pair.to))) {
        skipped++; // idempotency: this pair was already refreshed for this exact reference date
        continue;
      }

      let rate = computeCrossRate(pair.from, pair.to, ecbRates);
      let source = ECB_SOURCE;

      if (rate === null) {
        // The ECB does not quote this currency: try the fallback map on its own, never blended.
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
