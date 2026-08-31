/**
 * The RECURRENCE math (root TODO item 5) — pure, framework-agnostic, and deliberately the ONLY place
 * that knows how to move a schedule's `nextRunAt` forward. No Prisma, no BullMQ, no Nest: every
 * function here takes plain dates/numbers and returns plain dates/numbers, which is what makes the
 * month-end edge cases below testable by hand (cadence.spec.ts) rather than by running a real sweep.
 *
 * ## Four cadences, closed — no RRULE, no cron exposed to a user
 *
 * The old, removed `RecurringInvoice` (git tag `avant-refonte-documents`) offered EIGHT
 * (`RecurrenceFrequency`: WEEKLY/BIWEEKLY/MONTHLY/BIMONTHLY/QUARTERLY/QUADMONTHLY/SEMIANNUALLY/
 * ANNUALLY) — that enum is still physically present in schema.prisma, orphaned since the module was
 * deleted, and deliberately NOT reused here: this task's own brief asks for four, and a closed union
 * a person can actually reason about beats a longer list carried over just because it used to exist.
 * Nothing here rules out growing the union later; it simply is not asked for now.
 *
 * ## Why `anchorDay` is a value the SCHEDULE remembers, not one re-derived from the last occurrence
 *
 * A monthly schedule anchored on the 31st must read: 31 Jan -> 28/29 Feb -> 31 Mar -> 30 Apr -> 31
 * May -> ... — every month clamped independently against the ORIGINAL anchor, never drifting down
 * to whatever day the PREVIOUS (possibly-clamped) occurrence happened to land on. Re-deriving the
 * target day from `current.getUTCDate()` on every call would get February's 28 baked in as the new
 * "anchor" and never recover the 31st in March — a silent, permanent narrowing this module exists to
 * prevent (see computeNextOccurrence's own comment, and the March-of-a-31-anchored-schedule case in
 * cadence.spec.ts). `DocumentSchedule.anchorDay` (schema.prisma) is therefore captured ONCE, at
 * creation (schedules.service.ts), from the first occurrence's own day-of-month, and passed back
 * into every later call unchanged.
 *
 * ## Timezone: UTC, day-precision, deliberately
 *
 * A document's own 'date' fields (descriptors/field-kinds.ts's 'date' kind) accept whatever ISO
 * string the frontend's date picker sends — in practice a full `Date.toISOString()` timestamp (the
 * browser's local midnight, converted to UTC), never normalized to UTC midnight anywhere in this
 * codebase today (see e.g. actions/convert-to-invoice.ts's `issueDate: new Date().toISOString()`).
 * This module does NOT try to reproduce that ambiguity: every date it touches is treated as a
 * CALENDAR DAY, read and written using UTC getters/setters (`getUTCFullYear`/`Date.UTC`/...) so a
 * schedule's own arithmetic never depends on the machine's local timezone (the sweep runs on a
 * server, in whatever timezone its process happens to have) — the exact same reasoning
 * numbering/sequence.ts already holds for using the database's own clock rather than trusting a
 * caller's. `schedule-sweep-runner.ts`'s own header documents how this UTC-midnight value is then
 * turned into the actual `issueDate`/`dueDate` strings handed to "duplicate".
 */

export const SCHEDULE_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

export function isScheduleCadence(value: unknown): value is ScheduleCadence {
  return typeof value === 'string' && (SCHEDULE_CADENCES as readonly string[]).includes(value);
}

/** How many months one occurrence of `cadence` advances by — absent for "weekly", which advances by
 *  DAYS instead (see `computeNextOccurrence`). */
const MONTH_STEP: Partial<Record<ScheduleCadence, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** The number of days in `year`/`month` (1-indexed, i.e. 1 = January) — day 0 of the FOLLOWING month
 *  is, by definition, the last day of THIS one. Pure UTC arithmetic, no `Date` mutation. */
function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The day-of-month a brand-new schedule should remember as its own `anchorDay` — the first
 * occurrence's own UTC day-of-month. Meaningless (and never read) for "weekly", which has no month
 * to anchor a day within; callers still may call this unconditionally, it just won't be consulted.
 */
export function deriveAnchorDay(firstOccurrence: Date): number {
  return firstOccurrence.getUTCDate();
}

/**
 * Normalizes `date` to UTC MIDNIGHT of its own calendar day — see this file's header on why every
 * occurrence date this module produces or consumes is day-precision, never carrying a time-of-day
 * that could push it across a day boundary depending on which timezone happens to read it back.
 */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The single source of truth for "what is the NEXT occurrence after `current`" — called by the sweep
 * every time it dispatches an occurrence (schedule-sweep.ts), never by anything trying to predict
 * further ahead than one step: catch-up is deliberately ONE step per sweep pass (see
 * schedule-sweep.ts's own header on why), so this function is never asked to skip several occurrences
 * at once.
 *
 *  - "weekly": +7 calendar days, in UTC. No month to overflow, so no clamping question — every week
 *    is exactly 7 days regardless of which months it crosses.
 *  - "monthly"/"quarterly"/"yearly": advance by 1/3/12 months from `current`'s own UTC year/month,
 *    then land on `min(anchorDay, <days in that resulting month>)` — the clamp this file's header
 *    describes. `anchorDay` defaults to `current`'s own day-of-month ONLY when the caller genuinely
 *    has none to pass (defensive; every real schedule always has one once created — see
 *    `deriveAnchorDay`) — this fallback is intentionally the ONE place `current`'s own (possibly
 *    already-clamped) day is trusted, and only as a last resort, never the normal path.
 *
 * `current` is expected already UTC-midnight-normalized (`toUtcMidnight`) — this function does not
 * re-normalize it, so a caller that forgot to would carry a stray time-of-day forward. Every actual
 * caller in this codebase (schedule-sweep.ts) always passes an already-normalized value.
 */
export function computeNextOccurrence(current: Date, cadence: ScheduleCadence, anchorDay?: number): Date {
  if (cadence === 'weekly') {
    const next = new Date(current.getTime());
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  const monthStep = MONTH_STEP[cadence]!;
  const targetDay = anchorDay ?? current.getUTCDate();

  // `Date.UTC` itself already normalizes an out-of-range month (e.g. month index 13 rolls into next
  // year's January) — no manual year/month carry needed before this call.
  const totalMonths = current.getUTCFullYear() * 12 + current.getUTCMonth() + monthStep;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12; // 0-indexed, matches Date.UTC's own convention

  const clampedDay = Math.min(targetDay, daysInUtcMonth(targetYear, targetMonth + 1));
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}
