/**
 * "Is this category still in force on a given date" — the one piece of date-comparison logic this
 * catalog's temporal axis (`schema.ts`'s own `validFrom`/`validUntil`) needs, kept in its own small
 * file for the same reason `transports/channel-policy/mandate.ts` keeps its own date comparison out of
 * `registry.ts`: it is the one genuinely new piece of logic, and it deserves its own focused spec
 * (`in-force.spec.ts`) independent of the catalog's own loading tests (`data/all.spec.ts`) and
 * provenance-validation tests (`schema.spec.ts`).
 *
 * Deliberately compared as CALENDAR DATES, not raw timestamps: `validFrom`/`validUntil` are
 * `YYYY-MM-DD` (no time-of-day), and `onDate` — a caller's `new Date()`, an invoice's own `issueDate`,
 * or a bare ISO string — may carry a time-of-day the statute itself never had an opinion about. Both
 * sides are normalised to their UTC calendar-date component before comparing, so `2026-12-31T23:00:00Z`
 * (evening, UTC) and `2026-12-31` (bare) are both "the same day" as `validUntil: '2026-12-31'` — the
 * INCLUSIVE reading `schema.ts`'s own doc comment on `validUntil` requires. Comparing raw `Date#getTime()`
 * values instead would silently exclude part of the sunset's own last day for any `onDate` carrying a
 * non-midnight time, which is exactly the kind of off-by-one this field's own doc comment was written
 * to rule out.
 */
import { DomesticReverseChargeCategoryFact } from './schema';

/** `onDate`'s own UTC calendar date as `YYYY-MM-DD`, or `undefined` if `onDate` fails to parse. */
function toCalendarDate(onDate: string | Date): string | undefined {
  const date = onDate instanceof Date ? onDate : new Date(onDate);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

/**
 * True when `category` is in force on `onDate` — i.e. `onDate` is on or after `validFrom` (when set)
 * AND on or before `validUntil` (when set, INCLUSIVE — see `schema.ts`'s own doc comment on
 * `validUntil` for why). A category with neither field set is always in force: most categories in this
 * catalog carry no temporal bound at all, and that must stay the overwhelmingly common, zero-friction
 * case.
 *
 * An `onDate` that fails to parse returns `false` — never `true` — the same "an unparseable date is
 * never license to assume in force" posture `transports/channel-policy/mandate.ts#isOnOrAfter` already
 * holds for its own comparison.
 */
export function isCategoryInForce(
  category: DomesticReverseChargeCategoryFact,
  onDate: string | Date,
): boolean {
  const day = toCalendarDate(onDate);
  if (!day) return false;
  if (category.validFrom && day < category.validFrom) return false;
  if (category.validUntil && day > category.validUntil) return false;
  return true;
}
