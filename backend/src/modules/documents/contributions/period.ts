import { DocumentInstanceResult } from '../actions/action-registry';
import { dateValueInRange, dayMs } from '../date-params';
import { DashboardPeriod } from '../dto/dashboard-query.dto';

/**
 * Period and calendar-month helpers shared by every dashboard contribution. They used to be copied
 * into each contribution file, and a UTC bug had to be fixed in two copies; the per-type arithmetic
 * (amounts, statuses, widgets) still lives in each file, only the date plumbing is shared.
 */

/**
 * Every document from `all` whose own `dateKey` value falls within `period`'s inclusive range - THE
 * CONSISTENCY RULE (issue #418): reuses `date-params.ts`'s own `dateValueInRange`/`dayMs` pair, the
 * EXACT predicate `GET /documents`'s own `dateFrom`/`dateTo` filter applies, against the EXACT field
 * `list-filters.ts#resolveDateFieldKey` names for the type (each caller passes its own) - so a
 * period-scoped tile and the list its `link` opens can never independently drift on which documents
 * are "in" the period.
 *
 * `period` undefined -> returns `all`, the SAME array reference, unchanged: every period-aware figure
 * stays byte-identical to its pre-#418 behavior whenever no period is set. `dateKey` unresolved would
 * mean the same (never reached in practice for the types that call this - each descriptor declares
 * its date field - but a doubly-defensive `undefined` guard here costs nothing and never guesses).
 */
export function restrictToPeriod(
  all: DocumentInstanceResult[],
  period: DashboardPeriod | undefined,
  dateKey: string | undefined,
): DocumentInstanceResult[] {
  if (!period || !dateKey) return all;
  const fromMs = dayMs(period.dateFrom);
  const toMs = dayMs(period.dateTo);
  return all.filter((document) =>
    dateValueInRange((document.data as Record<string, unknown> | null)?.[dateKey], fromMs, toMs),
  );
}

/** "2026-08" for any parseable date-ish value, or null - used to bucket documents by month. */
export function monthKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // UTC getters, deliberately - the same calendar-day convention documents/schedules/cadence.ts
  // already documents for occurrence dates. Documents store date-only strings ("2026-09-01"),
  // which `new Date(...)` parses as UTC midnight; reading them back with LOCAL getters while
  // keying "now" off an ISO (UTC) string made the two disagree for the last two hours of every
  // UTC day east of Greenwich - and on 2026-08-31 evening that window crossed a MONTH boundary,
  // so an expense created "today" vanished from "this month" (caught live by the e2e battery).
  // One clock for both sides of the comparison, and it is the one the stored data already uses.
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `"2026-08"` -> `{ dateFrom: "2026-08-01", dateTo: "2026-08-31" }`: the exact UTC calendar-month
 *  boundaries `monthKey` itself buckets by, reused so a "this month" tile's `link` filters the list
 *  to precisely the same month the figure sums, never a boundary independently recomputed (and
 *  therefore possibly disagreeing) elsewhere. */
export function monthRange(key: string): { dateFrom: string; dateTo: string } {
  const [year, month] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { dateFrom: `${key}-01`, dateTo: `${key}-${String(lastDay).padStart(2, '0')}` };
}
