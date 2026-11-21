/**
 * Calendar-day query params (`YYYY-MM-DD`), shared by every endpoint that takes one: `GET /documents`
 * (`dto/list-documents.dto.ts`), the dashboard (`dto/dashboard-query.dto.ts`), the accounting export
 * and the revenue report. Each caller keeps its own `parseDateParam` and its own 400 message, which
 * are part of each endpoint's API contract; only the shape check and the day conversion are shared.
 */

/** `YYYY-MM-DD`, nothing looser: these params name a CALENDAR DAY, never an instant. */
export const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The pattern AND a date `Date` can parse at UTC midnight. Note: `Date` rolls an impossible day
 *  over (`2026-02-31` parses as 3 March), so such a day passes this check today; kept as is. */
export function isValidIsoDay(raw: string): boolean {
  return DATE_PARAM_PATTERN.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime());
}

/** `"YYYY-MM-DD"` -> the UTC midnight of that day, in milliseconds: UTC DAY boundaries throughout,
 *  the identical discipline `client-statement.ts`'s own `resolveAgingBucket` holds, so a document
 *  issued exactly "on" a boundary date behaves the same way everywhere. */
export function dayMs(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whether `dateValue` (whatever a document's date field currently holds, normally an ISO string,
 *  e.g. from a 'date' field's own `toISOString()`) falls within `[fromMs, toMs]`, each bound optional
 *  and inclusive, compared at UTC day boundaries. Missing/unparseable -> excluded: a document with no
 *  readable date cannot honestly be placed in ANY range - an honest default, never a guess. The ONE
 *  predicate `GET /documents`'s own `dateFrom`/`dateTo` filter (`persistence.ts`), the dashboard's
 *  period-scoped contributions (issue #418) and the accounting export's period all apply, so a period
 *  tile, the list its `link` opens and the export never put a boundary day on different sides. */
export function dateValueInRange(
  dateValue: unknown,
  fromMs: number | undefined,
  toMs: number | undefined,
): boolean {
  if (typeof dateValue !== 'string') return false;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return false;
  const ms = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  if (fromMs !== undefined && ms < fromMs) return false;
  if (toMs !== undefined && ms > toMs) return false;
  return true;
}
