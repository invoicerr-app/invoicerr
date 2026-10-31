/**
 * The sweep's pure decisions, split from `currency-rate-sweep-runner.ts` so the cross-rate arithmetic is
 * testable without a broker, an HTTP call or a database.
 *
 * One repeatable job fetches the global ECB feed once and refreshes every company's own pairs; the
 * runner's header says which pairs count as a company's own.
 */

import { Prisma } from '../../../../prisma/generated/prisma/client';

export const CURRENCY_RATE_SWEEP_JOB_NAME = 'currency-rate-sweep';
export const CURRENCY_RATE_SWEEP_JOB_ID = 'currency-rate-sweep-singleton';

/** Source stamped on a rate computed from the ECB feed, the reference the tax authorities publish
 *  against. */
export const ECB_SOURCE = 'ecb';

/** Source stamped on a rate that only the fallback could resolve. Kept distinct from `ECB_SOURCE`
 *  because the number ends up on a legal document, so its provenance must stay readable. */
export const EXCHANGERATE_API_SOURCE = 'exchangerate-api';

/** Every `CurrencyRate.source` value this sweep can write AUTOMATICALLY (`'manual'`, the only other
 *  value in use, is deliberately excluded). Two consumers share this set: the runner's own
 *  idempotency check (a pair already refreshed today by EITHER source needs no second attempt) and
 *  `convert.ts#findPairsWithoutAutomaticRate` (a pair with zero rows carrying one of these sources
 *  has provably been tried and failed by BOTH — currency-rates.store.ts's own
 *  `listCurrencyRatePairsWithoutAutomaticRate`, surfaced by the settings screen). */
export const AUTOMATIC_RATE_SOURCES: ReadonlySet<string> = new Set([ECB_SOURCE, EXCHANGERATE_API_SOURCE]);

/** Default 24h: the ECB publishes once a business day, so sweeping more often only re-observes the same
 *  reference date at the cost of an HTTP call. Env-overridable. */
export function readCurrencyRateSweepIntervalMs(): number {
  return parseInt(process.env.CURRENCY_RATE_SWEEP_INTERVAL_MS ?? '86400000', 10);
}

/**
 * Turns the ECB's EUR-based feed into a rate for any (from, to) pair. EUR is treated as an implicit
 * rate of 1; a pair with neither leg in EUR crosses through EUR; identical currencies return '1'. A
 * currency this pair needs but the map lacks returns null, never a guess.
 *
 * The same arithmetic serves the fallback map, called only when the ECB pass returned null and never
 * with a map mixing both sources.
 *
 * Returns a decimal string: a float division here would bake a rounding error permanently into the
 * rate column, which multiplies every converted amount downstream.
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

/**
 * Pure half of "refresh the pairs a company actually uses": from the grouped facts the runner reads,
 * decide which (from, to) pairs deserve a daily refresh. Two kinds come out: currency to the
 * company's reference currency (none when it never opted into consolidation), and payment currency to
 * the currency of the document it settles.
 *
 * `quotableCurrencies` filters both: a currency neither source quotes can never resolve, so it is
 * dropped here rather than reaching `computeCrossRate` to come back null. Duplicates are collapsed
 * into one flat list; the runner merges that with the pairs already stored.
 */
export interface CompanyReferenceCurrency {
  companyId: string;
  /** `null` when the company has never opted into consolidation - see `Company.referenceCurrency`'s
   *  own schema.prisma comment. Such a company contributes no `usedCurrencies` pair below, ever. */
  referenceCurrency: string | null;
}

/** One `(company, currency)` fact a company's OWN documents, clients or recorded payments actually
 *  used - the three sources are deliberately pre-merged into this single shape by the runner before
 *  calling this function, since all three resolve against the exact same target
 *  (`referenceCurrency`) and this function would otherwise have to repeat the identical branch three
 *  times for no benefit. */
export interface CompanyUsedCurrency {
  companyId: string;
  currency: string;
}

/** One `(company, paymentCurrency, documentCurrency)` fact a RECORDED payment actually used - kept
 *  separate from `CompanyUsedCurrency` above because its pair target is that SPECIFIC document's own
 *  currency, never the company-wide `referenceCurrency` (`settlement/convert-payment.ts`'s own
 *  header explains why those are different questions). */
export interface CompanyPaymentDocumentCurrencyPair {
  companyId: string;
  paymentCurrency: string;
  documentCurrency: string;
}

/** One pair this function decided is worth a daily refresh for one company - the exact shape
 *  `currency-rate-sweep-runner.ts`'s own `ActiveCurrencyRatePair` (scope (a)) already carries, so the
 *  runner can merge both lists with the same `pairKey`-based de-duplication. */
export interface NeededCurrencyPair {
  companyId: string;
  from: string;
  to: string;
}

export function deriveNeededCurrencyPairs(
  referenceCurrencies: readonly CompanyReferenceCurrency[],
  usedCurrencies: readonly CompanyUsedCurrency[],
  paymentDocumentPairs: readonly CompanyPaymentDocumentCurrencyPair[],
  quotableCurrencies: ReadonlySet<string>,
): NeededCurrencyPair[] {
  const referenceByCompany = new Map(referenceCurrencies.map((c) => [c.companyId, c.referenceCurrency]));
  const seen = new Set<string>();
  const result: NeededCurrencyPair[] = [];

  const add = (companyId: string, from: string, to: string) => {
    if (from === to) return; // identity conversion - convert.ts#computeCrossRate never needs a rate for it
    if (!quotableCurrencies.has(from) || !quotableCurrencies.has(to)) return;
    const key = `${companyId}\0${from}\0${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ companyId, from, to });
  };

  for (const { companyId, currency } of usedCurrencies) {
    const referenceCurrency = referenceByCompany.get(companyId);
    if (!referenceCurrency) continue; // no referenceCurrency chosen - nothing to consolidate against
    add(companyId, currency, referenceCurrency);
  }

  for (const { companyId, paymentCurrency, documentCurrency } of paymentDocumentPairs) {
    add(companyId, paymentCurrency, documentCurrency);
  }

  return result;
}
