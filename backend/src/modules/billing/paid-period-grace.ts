/**
 * Terms of Service Section 20.2: a Terms change binds immediately, except that a Company with a paid
 * period in progress keeps full use until the later of (a) the first of the month after publication
 * and (b) its own renewal date. The later, so the calendar floor never cuts an annual period short.
 *
 * `status === 'ACTIVE'` is required so this never reopens writes for BLOCKED/ZIPPED/PAST_DUE/TRIAL.
 * The `PAST_DUE` suspension rule in `lifecycle.ts` reads the bottom two functions instead, since for
 * it a `PAST_DUE` Company with a still-paid period is exactly the case in question.
 *
 * Taking the LATER of the two, never the earlier: the point of both dates is to protect a period
 * actually paid for, so whichever protects it longer wins. This is deliberately never a shorter,
 * "earlier of the two" floor — that would let the calendar date cut a long-running (e.g. annual) period
 * short, exactly the harm Section 20.2 exists to prevent.
 *
 * `status === 'ACTIVE'` is a hard requirement, not merely the common case: it is what keeps this
 * exception from ever reopening writes for a Company already refused them for an unrelated reason —
 * `BLOCKED`/`ZIPPED` (the Section 13.1 non-payment suspension, `write-gate.ts`'s own gate on those two
 * statuses runs independently and first, but this is checked here too, defensively, rather than relying
 * on guard ordering alone) and `PAST_DUE` (a renewal payment already failed — by definition there is no
 * currently-paid-for period left to protect) all read as "no grace" through this one condition, with no
 * separate exclusion list to keep in sync. `TRIAL` reads the same way: the free trial is not a
 * subscription period paid for at all — Section 20.2 says as much by name.
 *
 * ## The same period, read by the OTHER decision that can take the Service away
 * Section 20.2's exception is not the only rule that turns on "what has this Company already paid
 * for": Section 13.1 opens the read-only suspension when a paid subscription ENDS, which a renewal
 * payment failing part-way through an already-paid period is not. That decision lives in
 * `lifecycle.ts#computeLifecycleTransition`'s own `PAST_DUE` branch and reads the two functions at the
 * BOTTOM of this file (`paidThroughEndOfDay`/`isPaidPeriodStillRunning`) rather than
 * `paidPeriodBindingDate` above — deliberately, because the two questions differ on exactly one point:
 * this Section-20.2 exception is barred for a `PAST_DUE` Company (a Terms change it has not accepted
 * must not reopen writes for a Company already refused them for non-payment), whereas the suspension
 * question IS the `PAST_DUE` case. One file, one definition of "the period already paid for", two
 * rules reading it for their own reason.
 *
 * Re-derived fresh on every check from the CURRENT `status`/`currentPeriodEnd` (never a single grace
 * end date computed once and cached): a paid period that in fact ends EARLIER than the later of (a)/(b)
 * above (a cancellation lands, a renewal payment fails) loses ACTIVE status the moment the payment provider
 * reports it, which immediately narrows this exception back down
 * to nothing for that Company — the computed date is only ever an upper bound on how long the paid
 * period can protect the Company, never a promise independent of the subscription actually staying paid
 * that long.
 */
import { CompanySubscriptionStatus } from '../../../prisma/generated/prisma/client';

export interface CompanySubscriptionPeriodFacts {
  status: CompanySubscriptionStatus;
  /** The subscription's own current period end, mirrored verbatim - `null` for a Company with no
   *  subscription fact recorded yet (still `TRIAL`, or an `ACTIVE` row from before this column
   *  existed and no provider event has landed since). See `schema.prisma`'s own comment on this column for
   *  where it is written from. */
  currentPeriodEnd: Date | null;
}

/** UTC, so the result never depends on the server's timezone. */
export function firstOfMonthFollowing(publishedAt: Date): Date {
  return new Date(Date.UTC(publishedAt.getUTCFullYear(), publishedAt.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** When a change published at `publishedAt` starts binding; `null` if no paid period is in progress. */
export function paidPeriodBindingDate(sub: CompanySubscriptionPeriodFacts, publishedAt: Date): Date | null {
  if (sub.status !== 'ACTIVE' || sub.currentPeriodEnd === null) return null;

  const floor = firstOfMonthFollowing(publishedAt);
  return sub.currentPeriodEnd.getTime() > floor.getTime() ? sub.currentPeriodEnd : floor;
}

/**
 * True while `now` has not yet reached the binding date above — i.e. the pending-acceptance write
 * lockout `legal-acceptance.guard.ts` would otherwise apply immediately is deferred for this Company.
 * `false` (never exempted) for a Company with no protectable period at all, or once its own binding
 * date has passed — at which point the ordinary pending-acceptance gate resumes with no code of its own
 * needed here (Section 20.2's own "the subscription does not continue on the new Terms" is the existing
 * Section 13 non-renewal machinery observing whatever the payment provider reports next, not a transition this module
 * drives).
 */
export function isWithinPaidPeriodGrace(
  sub: CompanySubscriptionPeriodFacts,
  publishedAt: Date,
  now: Date,
): boolean {
  const bindingDate = paidPeriodBindingDate(sub, publishedAt);
  return bindingDate !== null && now.getTime() < bindingDate.getTime();
}

/**
 * The first instant NO LONGER covered by what a Company has already paid for: midnight UTC opening the
 * day AFTER the one `currentPeriodEnd` falls in. `null` when no period end is on file at all (a
 * Company still in its free trial, or one no provider fact has ever carried one for - nothing paid for,
 * so nothing to protect).
 *
 * A whole DAY, not the raw renewal instant, because of what reads this: losing the Service is a
 * working-day event for everyone in the Company, while the instant itself is an accident of what time
 * of day the Company happened to subscribe (03:14, say). Cutting a Company off mid-morning on a day it
 * paid for, because its renewal timestamp falls earlier in that same day, is the outcome this rounding
 * exists to prevent; rounding can only ever extend, never shorten, what was bought.
 *
 * UTC, never the server's own timezone, and `Date.UTC` rather than `setDate` on a local Date — the
 * same discipline `firstOfMonthFollowing` above holds, and for the same reason: the day a Company is
 * suspended on must not depend on which region the container happens to run in. `Date.UTC` carries a
 * day overflow into the next month/year on its own, so 31 December needs no special case.
 */
export function paidThroughEndOfDay(currentPeriodEnd: Date | null | undefined): Date | null {
  // `undefined` too: a row read before this column existed carries neither a date nor `null`.
  if (!currentPeriodEnd) return null;

  return new Date(
    Date.UTC(
      currentPeriodEnd.getUTCFullYear(),
      currentPeriodEnd.getUTCMonth(),
      currentPeriodEnd.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
}

export function isPaidPeriodStillRunning(currentPeriodEnd: Date | null | undefined, now: Date): boolean {
  const paidThrough = paidThroughEndOfDay(currentPeriodEnd);
  return paidThrough !== null && now.getTime() < paidThrough.getTime();
}
