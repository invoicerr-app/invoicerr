/**
 * Terms of Service Section 20.2: a Terms change binds immediately, except that a Company with a paid
 * period in progress keeps full use until the later of (a) the first of the month after publication
 * and (b) its own renewal date. The later, so the calendar floor never cuts an annual period short.
 *
 * `status === 'ACTIVE'` is required so this never reopens writes for BLOCKED/ZIPPED/PAST_DUE/TRIAL.
 * The `PAST_DUE` suspension rule in `lifecycle.ts` reads the bottom two functions instead, since for
 * it a `PAST_DUE` Company with a still-paid period is exactly the case in question.
 *
 * Recomputed on every check from current status, never cached: a cancellation or failed renewal must
 * end the grace as soon as Polar reports it.
 */
import { CompanySubscriptionStatus } from '../../../prisma/generated/prisma/client';

export interface CompanySubscriptionPeriodFacts {
  status: CompanySubscriptionStatus;
  /** `null` until a Polar subscription fact lands, including legacy `ACTIVE` rows. */
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

/** True while the pending-acceptance write lockout is deferred for this Company. */
export function isWithinPaidPeriodGrace(
  sub: CompanySubscriptionPeriodFacts,
  publishedAt: Date,
  now: Date,
): boolean {
  const bindingDate = paidPeriodBindingDate(sub, publishedAt);
  return bindingDate !== null && now.getTime() < bindingDate.getTime();
}

/**
 * Midnight UTC after the day `currentPeriodEnd` falls in. Rounded up to a whole day so a Company is
 * never cut off mid-day on a day it paid for; UTC so it never depends on the server's timezone.
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
