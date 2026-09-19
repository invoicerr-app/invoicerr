/**
 * Small helpers shared by the per-country providers.
 * Anything specific to one register stays in that country's file.
 */

/** Joins address fragments, dropping the empty ones. */
export function join(...parts: (string | number | undefined | null)[]): string | undefined {
  const s = parts
    .map((p) => (p === undefined || p === null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' ')
    .trim();
  return s || undefined;
}

/** Today in the register's own timezone — several APIs reject a "future" date. */
export function localDate(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
