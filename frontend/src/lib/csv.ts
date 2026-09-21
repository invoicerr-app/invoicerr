/**
 * The ONE CSV cell escaper every CSV this frontend writes goes through (`hooks/use-table-export.ts`).
 * The deliberate mirror of the backend's own `backend/src/utils/csv.ts` — the two projects share no
 * package, so the code cannot be shared, but the RULE is: a CSV this product emits is escaped the
 * same way whichever side built it, and a second emitter imports this rather than growing its own
 * `csvEscape`. Keeping the two in step is exactly what having one file per project makes possible.
 *
 * TWO escapes in one function rather than two a caller could apply only one of, and the ORDER
 * between them is load-bearing:
 *
 *  1. SYNTAX (RFC 4180 §2.6/2.7) — what keeps the FILE parseable: a field carrying the delimiter, a
 *     double quote, or a line break is wrapped in double quotes, interior quotes doubled.
 *  2. FORMULA — what keeps the READER safe: a spreadsheet evaluates a cell whose first character is
 *     `=`, `+`, `-` or `@` as a formula. Quoting does NOT defuse it — the quotes are CSV syntax,
 *     stripped before the cell reaches the formula parser, so `"=HYPERLINK(...)"` runs exactly like
 *     `=HYPERLINK(...)`. A leading apostrophe does, and costs the cell one visible character; a tab
 *     or a space would also work but both are whitespace an importer is entitled to trim, re-arming
 *     the payload on the way back in.
 *
 * The carve-out that makes this more than a one-liner: `-` is also the first character of every
 * negative amount a table legitimately exports. A value whose trigger is `+`/`-` and which is
 * otherwise a plain decimal number is left exactly as it is, so `-120.00` stays a number in the
 * spreadsheet and in any re-import, while `-1+1` does not.
 */

/** The four formula triggers, plus the two whitespace characters that reach the formula parser the
 *  same way — a payload hidden behind a leading tab is the standard way past a guard that only
 *  looks at `=+-@`. */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/** A plain decimal number and nothing looser: no exponent, no thousands separator, no unit. */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

const NEEDS_QUOTING = /[",\r\n]/

/** Whether a spreadsheet opening this CSV would evaluate `value` as a formula. */
export function isSpreadsheetFormula(value: string): boolean {
  if (!FORMULA_LEAD.test(value)) return false
  // A negative (or explicitly positive) amount is a NUMBER to every spreadsheet, never a formula.
  return !PLAIN_NUMBER.test(value)
}

/**
 * One CSV field, safe to concatenate with `,`. Formula guard FIRST, then quoting — the other order
 * reopens the hole for exactly the payloads that also carry a comma or a quote: quoting
 * `=SUM(1,2)` yields `"=SUM(1,2)"`, whose first character is now `"`, so a formula check running
 * afterwards sees no trigger — and the spreadsheet strips those quotes back off before parsing.
 */
export function escapeCsvCell(value: string): string {
  const guarded = isSpreadsheetFormula(value) ? `'${value}` : value
  if (NEEDS_QUOTING.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

/** One CSV line — every cell escaped, comma-joined. No trailing separator, no trailing break. */
export function toCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvCell).join(",")
}
