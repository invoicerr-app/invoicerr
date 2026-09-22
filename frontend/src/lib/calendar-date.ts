/**
 * A date a human picks in a form is a CALENDAR DATE — "31 May 2026", a square on a wall calendar —
 * not an instant on a timeline. The two only coincide in UTC, and the five countries this product
 * targets (FR, PL, IT, PT, DE) all sit east of Greenwich, so the difference is never academic for
 * them: `react-day-picker` hands back a `Date` at LOCAL midnight, and `toISOString()` on that lands
 * on the PREVIOUS UTC day for every one of them — Paris/Warsaw/Rome/Berlin two hours in summer,
 * Lisbon one.
 *
 * That is not a display detail, because a document's issue date is what SELECTS the country rule
 * that applies to it. On the backend, `transports/channel-policy/mandate.ts` compares an invoice's
 * own `issueDate` against a mandate's `mandatedFrom` as calendar days, `archive/retention` counts a
 * retention origin from it, and `formats/shared-build.ts#toDateOnly` cuts the day out of it for
 * EN 16931's BT-2, FA(3)'s `P_1` and FatturaPA's `Data`. Nothing there rewrites what this form
 * sends — a `kind: 'date'` value is validated for shape and then persisted byte for byte — so the
 * day produced here IS the document's legal date, and a day lost on the way in is a legally wrong
 * document at every month, quarter and year boundary, and on the day any mandate comes into force.
 *
 * Hence the boundary rule, stated once and applied in BOTH directions:
 *
 *  - WRITING. The `Date` a calendar hands back names a day in the USER's own timezone, so the day
 *    is read off its LOCAL `getFullYear()/getMonth()/getDate()` and written as a bare "YYYY-MM-DD".
 *    Bare rather than an instant, because the backend reads these strings two different ways — some
 *    consumers take the literal ten-character prefix (`mandate.ts`, `accounting-export`,
 *    `fa3-kor.ts`), others convert through `new Date(...)` first (`archive/persistence.ts`,
 *    `tax/resolve-invoice-tax.ts`, the mentions resolver) — and a bare calendar date is the one
 *    shape both camps agree on in every timezone, since `new Date("2026-05-31")` parses as UTC
 *    midnight and slices straight back to "2026-05-31".
 *
 *  - READING. A stored "YYYY-MM-DD" names a day with no timezone at all, so it is rebuilt at LOCAL
 *    midnight, digit by digit. `new Date("2026-05-31")` would instead parse as UTC midnight and
 *    show 30 May to everyone WEST of Greenwich — the same defect, mirrored. A legacy full timestamp
 *    ("2026-05-30T22:00:00.000Z", the shape this form used to send) is read the same way, off its
 *    leading day: that is the day the backend has always treated as the document's legal date, so
 *    the screen now states it instead of reconstructing a different one from the instant — the
 *    disagreement between the two is exactly what kept this invisible.
 *
 * `document-list.tsx`'s `dateFrom`/`dateTo` filters held this rule locally before it was shared;
 * they now delegate here, so the two cannot drift apart.
 */

/** A picked `Date` → the bare "YYYY-MM-DD" calendar day it names in the user's own timezone.
 *  `undefined` (never a string) for "nothing picked", which is what a cleared form field stores. */
export function toCalendarDate(date: Date | null | undefined): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** A stored calendar day — a bare "YYYY-MM-DD", or the leading day of a legacy full ISO timestamp —
 *  → a `Date` at LOCAL midnight, which is exactly the shape `<DatePicker>`'s own calendar produces,
 *  so a value read back and a value just picked are indistinguishable to every caller.
 *
 *  A `Date` already in hand is passed through untouched: some forms (a client's `foundedAt`) keep a
 *  real `Date` in their react-hook-form state rather than a string, and re-deriving one would only
 *  lose whatever it already says. */
export function fromCalendarDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== "string") return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!parts) return null
  const [, year, month, day] = parts.map(Number)
  const date = new Date(year, month - 1, day)
  // A two- or three-digit year is mapped into the 1900s by the `Date(year, …)` constructor, which
  // would silently answer 1999 for "0099"; `setFullYear` is the only way to state the year literally.
  date.setFullYear(year)
  // An impossible day ("2026-02-30", "2026-13-01") is not a date: the constructor rolls it over into
  // the next month rather than refusing, so the only way to reject one is to read the components back
  // and see whether they still say what the string said.
  const rolledOver = date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
  return rolledOver ? null : date
}

/** The same calendar day, expressed as the UTC instant that names it ("2026-05-31T00:00:00.000Z").
 *
 *  For the one kind of field that cannot take a bare day: a value landing DIRECTLY in a Prisma
 *  `DateTime` column with no coercion of its own — a company's or client's `foundedAt`, passed
 *  straight through by `company.service.ts#editCompanyInfo`. Prisma refuses a bare calendar date
 *  there outright ("Invalid value for argument `foundedAt`: premature end of input. Expected
 *  ISO-8601 DateTime.", measured against the real client), while it accepts this shape — which still
 *  names the day the user picked, in every timezone, rather than the day their own offset happens to
 *  push `toISOString()` onto. `fromCalendarDate` reads it back off the same leading day, so the pair
 *  round-trips identically to a bare one.
 *
 *  Everything stored as TEXT — every `kind: 'date'` document field, where the legal dates live —
 *  uses `toCalendarDate` instead: a bare day cannot be re-read as an instant by a later reader, and
 *  that is the property worth having wherever a country rule is selected by the date. */
export function toCalendarDateInstant(date: Date | null | undefined): string | undefined {
  const day = toCalendarDate(date)
  return day === undefined ? undefined : `${day}T00:00:00.000Z`
}

/** Today, as the calendar day it is where the USER is — never `new Date()`, whose time of day makes
 *  it an instant, and whose UTC day is yesterday's between UTC midnight and local midnight. Returns
 *  the stored shape; `fromCalendarDate` turns it back into a picker value where one is wanted. */
export function todayCalendarDate(): string {
  const now = new Date()
  return toCalendarDate(now) as string
}
