/**
 * The ONE CSV cell escaper every CSV this backend emits goes through — today
 * `modules/documents/accounting-export/build-accounting-csv.ts`, the only one; a second emitter
 * imports this rather than growing its own `escapeField`, which is exactly how the two that existed
 * before this file drifted into having the same hole twice.
 *
 * TWO escapes, deliberately in one function rather than two a caller could remember to apply only
 * one of — they are not independent, and the ORDER between them is load-bearing (see
 * `escapeCsvCell`):
 *
 *  1. SYNTAX (RFC 4180 §2.6/2.7) — what keeps the FILE parseable: a field carrying the delimiter, a
 *     double quote, or a line break is wrapped in double quotes with any interior quote doubled.
 *  2. FORMULA — what keeps the READER safe: a spreadsheet (Excel, LibreOffice, Numbers, Sheets)
 *     evaluates a cell whose first character is `=`, `+`, `-` or `@` as a formula, not as text.
 *     Quoting does NOT defuse this: the quotes are CSV syntax, stripped before the cell ever reaches
 *     the formula parser, so `"=HYPERLINK(...)"` runs exactly like `=HYPERLINK(...)`. The one thing
 *     that does is a character the formula parser refuses to start a formula with — see below.
 *
 * ## Why a leading apostrophe, and what it costs
 *
 * The apostrophe is the conventional answer, and it is the only one that costs the cell nothing but
 * one visible character: a tab or a space also defuses the formula, but both are whitespace an
 * importer is entitled to trim — re-arming the payload on the way back in. A stripped or rejected
 * cell loses the data outright.
 *
 * Honest about what it is NOT: the apostrophe is real bytes in the file, not a display trick. A
 * strict reader (RFC 4180, our own `modules/documents/bank-reconciliation/parse-csv.ts` included)
 * hands the consumer `'=HYPERLINK(...)` apostrophe and all; some spreadsheets consume it as their
 * own "this cell is text" prefix and show it, others display it. So the escape is deliberately
 * NARROW — it can only ever reach a cell that already begins with a formula trigger, never a cell
 * that does not.
 *
 * ## The negative-amount carve-out, which is the whole reason this is not a one-line fix
 *
 * `-` is both a formula trigger and the first character of every negative amount an accounting
 * ledger legitimately carries. Prefixing `-120.00` would hand the accounting software importing
 * this file the TEXT `'-120.00` where it expects a number — an escape that breaks the export's one
 * job, which is worse than the hole it closes. A value whose formula trigger is `+`/`-` and which
 * is otherwise a plain decimal number is therefore left exactly as it is: `-120.00` stays a number
 * in the spreadsheet AND in the re-import, and `-1+cmd|'/c calc'!A1` (not a number) does not.
 */

/** The four characters a spreadsheet reads as "this cell is a formula", plus the two whitespace
 *  characters that reach the formula parser the same way once a leading run of them is skipped —
 *  a payload hidden behind a tab or a carriage return is the standard way past a guard that only
 *  looks at `=+-@`. `\r` can only appear here mid-value (a line break also triggers rule 1's
 *  quoting), `\t` freely. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** A plain decimal number, and nothing looser — no exponent (`1e3`), no thousands separator, no
 *  trailing unit. Every amount this codebase renders into a CSV comes from `utils/financial.ts`'s
 *  own `fromMinor(...).toFixed(decimalsFor(...))`, which produces exactly this shape, so widening
 *  this pattern would only ever exempt values that are NOT amounts. */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Characters that force RFC 4180 quoting — the delimiter, the quote itself, and either half of a
 *  line break. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Whether `value` would be evaluated as a formula by a spreadsheet opening this CSV. Exported for
 * the tests that pin the negative-amount carve-out on its own, separately from the escaping around
 * it.
 */
export function isSpreadsheetFormula(value: string): boolean {
  if (!FORMULA_LEAD.test(value)) return false;
  // A negative (or explicitly positive) amount is a NUMBER to every spreadsheet and every importer,
  // never a formula — see this file's own header on why exempting it is the point.
  return !PLAIN_NUMBER.test(value);
}

/**
 * One CSV field, safe to concatenate with `,`. Formula guard FIRST, then RFC 4180 quoting — the
 * other order silently reopens the hole for exactly the payloads that also carry a comma or a
 * quote: quoting `=SUM(1,2)` yields `"=SUM(1,2)"`, whose first character is now `"`, so a formula
 * check running afterwards sees no trigger and lets it through — and the spreadsheet strips those
 * quotes back off before parsing the cell. Guarding first also means the apostrophe is part of the
 * string the quoting decision is then made on, so a guarded value carrying a comma is still quoted.
 */
export function escapeCsvCell(value: string): string {
  const guarded = isSpreadsheetFormula(value) ? `'${value}` : value;
  if (NEEDS_QUOTING.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** One CSV line — every cell escaped, comma-joined. No trailing line break: joining lines is the
 *  caller's own decision (`build-accounting-csv.ts` joins with `\n`, this codebase's own
 *  convention). */
export function toCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvCell).join(',');
}
