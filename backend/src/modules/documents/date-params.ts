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
