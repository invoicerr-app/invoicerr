import { CurrencyRateLike, convertMinor, resolveLatestRate } from '../../company/currency-rates/convert';

/**
 * Issue #516's "cashed-revenue view per period" - money ACTUALLY received (`DocumentPayment.paidAt`,
 * the same fact `invoice-contributions.ts`'s own "Collected this/in period" tiles already read),
 * bucketed into calendar months or quarters, never invoiced amounts. This is the explicit, literal
 * answer to the issue's option C (see `RECHERCHE_192_MULTIDEVISE.md`'s own §5): several regimes this
 * product serves declare cashed revenue, not invoiced revenue (FR micro-entrepreneur/URSSAF, IT
 * regime forfettario's "compensi percepiti", DE's §11 EStG for income tax) - a company under one of
 * those needs to see what it can legally declare, not this product's own "invoiced this month" tiles.
 *
 * Pure and DB-free, same discipline as `contributions/currency-consolidation.ts`'s own
 * `consolidateByCurrency` - `revenue-report.service.ts` is the only caller that talks to Prisma.
 *
 * ## Why this is NOT `consolidateByCurrency` reused
 * That function takes ALREADY-SUMMED per-currency totals and resolves ONE shared rate for the whole
 * call (`now`, or since issue #516's own `resolveConsolidationInstant`, one shared dated instant).
 * Here the issue asks for something dated PER PAYMENT: "converted at each payment's frozen rate"  -
 * each payment in the period may honestly resolve to a DIFFERENT rate (a different `asOf`), because
 * each payment is dated by its OWN `paidAt`, not by the period's end. So this file resolves
 * `payment.currency -> referenceCurrency` once PER PAYMENT, dated to that payment's own `paidAt`  -
 * the exact same "dated, frozen, never re-resolved on a later read" philosophy
 * `settlement/convert-payment.ts` already applies to a payment's OWN document-currency conversion,
 * just aimed at a DIFFERENT pair (the payment's currency against the company's reference currency,
 * which `convert-payment.ts` never touches).
 *
 * Same "never a partial sum" honesty `consolidateByCurrency` holds, applied per CURRENCY within a
 * period: if even one payment in a currency this period saw has no resolvable rate at its own
 * `paidAt`, that whole currency's contribution to the period's consolidated total is omitted (never
 * a total silently missing one payment) and a warning names it - the per-currency `byCurrency`
 * breakdown is unaffected either way, exactly like the dashboard's own per-currency metrics stay
 * intact when their own consolidated sibling cannot be built.
 */

export type RevenueGranularity = 'monthly' | 'quarterly';

export interface CashedPaymentLike {
  currency: string;
  amountMinor: number;
  paidAt: Date;
}

export interface CashedRevenueCurrencyAmount {
  currency: string;
  totalMinor: number;
}

export interface CashedRevenueConsolidated {
  currency: string;
  totalMinor: number;
  /** One line per PAYMENT that needed converting - not one per currency: two payments in the same
   *  currency, dated far enough apart, can legitimately cite two different rates. Deduplicated
   *  (identical rate/date/source) so a period with many same-day payments doesn't repeat itself. */
  notes: string[];
}

export interface CashedRevenuePeriod {
  /** `"2026-08"` (monthly) or `"2026-Q3"` (quarterly) - stable, sortable, and what the `period` query
   *  param below round-trips. */
  key: string;
  /** Human-facing - "August 2026" / "Q3 2026". */
  label: string;
  /** UTC calendar bounds, inclusive, `YYYY-MM-DD` - the exact period this bucket's figures cover. */
  dateFrom: string;
  dateTo: string;
  /** Every currency actually cashed this period, sorted - present even when `totalMinor` is 0 (see
   *  `enumeratePeriodKeys` below: this module always emits a period for every key spanning the
   *  requested range, cashed or not, since a URSSAF declaration is filed "même si celui-ci est nul"
   *  - even when it is zero - and a report that silently skips a quiet period would misrepresent
   *  that as "not yet declared" rather than "declared, zero"). */
  byCurrency: CashedRevenueCurrencyAmount[];
  /** `null` under the exact same conditions `consolidateByCurrency`'s own `ConsolidationOutcome`
   *  documents: no `referenceCurrency` configured, nothing cashed this period, or at least one
   *  currency this period saw has no resolvable rate. */
  consolidated: CashedRevenueConsolidated | null;
  warnings: string[];
}

/** UTC calendar-day arithmetic throughout - the same discipline `accounting-export.service.ts`'s own
 *  `dayMs`/`issueDateInRange` already holds, so a payment dated exactly on a period boundary is
 *  bucketed the same way here as it would be filtered there. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function quarterOf(monthIndex0: number): number {
  return Math.floor(monthIndex0 / 3) + 1;
}

export function periodKeyFor(date: Date, granularity: RevenueGranularity): string {
  const year = date.getUTCFullYear();
  if (granularity === 'monthly') return `${year}-${pad2(date.getUTCMonth() + 1)}`;
  return `${year}-Q${quarterOf(date.getUTCMonth())}`;
}

/** `"2026-08"` -> `{ dateFrom: "2026-08-01", dateTo: "2026-08-31" }`; `"2026-Q3"` ->
 *  `{ dateFrom: "2026-07-01", dateTo: "2026-09-30" }`. Throws on a key this module never produces
 *  itself - a malformed `period` query param is the controller's own job to reject before this ever
 *  sees it (see `revenue-report.service.ts#parsePeriodKey`). */
export function periodBounds(
  key: string,
  granularity: RevenueGranularity,
): { dateFrom: string; dateTo: string } {
  if (granularity === 'monthly') {
    const [yearStr, monthStr] = key.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr); // 1-12
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { dateFrom: `${yearStr}-${monthStr}-01`, dateTo: `${yearStr}-${monthStr}-${pad2(lastDay)}` };
  }
  const [yearStr, quarterStr] = key.split('-Q');
  const year = Number(yearStr);
  const quarter = Number(quarterStr); // 1-4
  const startMonth = (quarter - 1) * 3; // 0-indexed
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth + 1, 0)).getUTCDate();
  return {
    dateFrom: `${yearStr}-${pad2(startMonth + 1)}-01`,
    dateTo: `${yearStr}-${pad2(endMonth + 1)}-${pad2(lastDay)}`,
  };
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function periodLabelFor(key: string, granularity: RevenueGranularity): string {
  if (granularity === 'monthly') {
    const [yearStr, monthStr] = key.split('-');
    return `${MONTH_LABELS[Number(monthStr) - 1]} ${yearStr}`;
  }
  const [yearStr, quarterPart] = key.split('-Q');
  return `Q${quarterPart} ${yearStr}`;
}

/** Every period key from `from` through `to` (both `YYYY-MM-DD`, inclusive), oldest first - what
 *  makes a quiet period show up as a genuine "0 cashed" row instead of silently vanishing (see
 *  `CashedRevenuePeriod.byCurrency`'s own header on why that distinction matters for a declaration
 *  aid). Deliberately capped by the CALLER (`revenue-report.service.ts`'s own bound on the requested
 *  range) - this function itself has no opinion on how wide a range is reasonable to ask for. */
export function enumeratePeriodKeys(from: string, to: string, granularity: RevenueGranularity): string[] {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const keys: string[] = [];
  const step = granularity === 'monthly' ? 1 : 3;
  let cursor = Date.UTC(fromYear, fromMonth - 1, 1);
  const end = Date.UTC(toYear, toMonth - 1, 1);
  while (cursor <= end) {
    const d = new Date(cursor);
    keys.push(periodKeyFor(d, granularity));
    cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1);
  }
  return keys;
}

/** `"2026-08-15"` -> the UTC midnight of that day, in milliseconds - matches
 *  `accounting-export.service.ts`'s own `dayMs`. */
function dayMs(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** One payment's own `paidAt` -> which period key it belongs to, compared at UTC day boundaries  -
 *  the same bucketing `monthKey`/`monthRange` already apply elsewhere in this module for an ISSUE
 *  date, here applied to a payment's own date instead. */
function periodKeyForPayment(paidAt: Date, granularity: RevenueGranularity): string {
  return periodKeyFor(paidAt, granularity);
}

/**
 * Builds one `CashedRevenuePeriod` per key in `[from, to]` (see `enumeratePeriodKeys`), from every
 * `payments` row whose own `paidAt` falls in that same range - `payments` is expected to already be
 * exactly the set that counts as revenue (sent, non-cancelled invoices' own payments; the caller's
 * job, mirroring `invoice-contributions.ts`'s own `issuedInvoiceIds` filter).
 */
export function buildCashedRevenuePeriods(
  payments: readonly CashedPaymentLike[],
  from: string,
  to: string,
  granularity: RevenueGranularity,
  referenceCurrency: string | null | undefined,
  rates: readonly CurrencyRateLike[],
): CashedRevenuePeriod[] {
  const fromMs = dayMs(from);
  const toMs = dayMs(to);

  const byPeriod = new Map<string, CashedPaymentLike[]>();
  for (const payment of payments) {
    const paidMs = Date.UTC(
      payment.paidAt.getUTCFullYear(),
      payment.paidAt.getUTCMonth(),
      payment.paidAt.getUTCDate(),
    );
    if (paidMs < fromMs || paidMs > toMs) continue;
    const key = periodKeyForPayment(payment.paidAt, granularity);
    const bucket = byPeriod.get(key) ?? [];
    bucket.push(payment);
    byPeriod.set(key, bucket);
  }

  return enumeratePeriodKeys(from, to, granularity).map((key) => {
    const bounds = periodBounds(key, granularity);
    const periodPayments = byPeriod.get(key) ?? [];

    const byCurrencyMap = new Map<string, number>();
    for (const payment of periodPayments) {
      byCurrencyMap.set(payment.currency, (byCurrencyMap.get(payment.currency) ?? 0) + payment.amountMinor);
    }
    const byCurrency: CashedRevenueCurrencyAmount[] = [...byCurrencyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, totalMinor]) => ({ currency, totalMinor }));

    let consolidated: CashedRevenueConsolidated | null = null;
    const warnings: string[] = [];

    if (referenceCurrency && periodPayments.length > 0) {
      const missingCurrencies = new Set<string>();
      const currenciesNeedingConversion = new Set(
        periodPayments.filter((p) => p.currency !== referenceCurrency).map((p) => p.currency),
      );
      for (const currency of currenciesNeedingConversion) {
        const hasEveryRate = periodPayments
          .filter((p) => p.currency === currency)
          .every((p) => resolveLatestRate(rates, currency, referenceCurrency, p.paidAt) !== null);
        if (!hasEveryRate) missingCurrencies.add(currency);
      }

      if (missingCurrencies.size > 0) {
        for (const currency of missingCurrencies) {
          warnings.push(`No ${currency}→${referenceCurrency} rate is set - consolidated total omitted.`);
        }
      } else {
        let totalMinor = 0;
        const notes: string[] = [];
        const seenNotes = new Set<string>();
        for (const payment of periodPayments) {
          if (payment.currency === referenceCurrency) {
            totalMinor += payment.amountMinor;
            continue;
          }
          // Non-null: every currency here already passed the `missingCurrencies` check above.
          const rate = resolveLatestRate(rates, payment.currency, referenceCurrency, payment.paidAt)!;
          totalMinor += convertMinor(payment.amountMinor, payment.currency, referenceCurrency, rate.rate);
          const note = `${payment.currency}→${referenceCurrency} @ ${rate.rate} (${rate.source}, ${rate.asOf
            .toISOString()
            .slice(0, 10)})`;
          if (!seenNotes.has(note)) {
            seenNotes.add(note);
            notes.push(note);
          }
        }
        consolidated = { currency: referenceCurrency, totalMinor, notes };
      }
    }

    return { key, label: periodLabelFor(key, granularity), ...bounds, byCurrency, consolidated, warnings };
  });
}
