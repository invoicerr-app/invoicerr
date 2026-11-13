/**
 * The hosted-billing lifecycle's own PURE decisions — split from `billing-lifecycle-sweep-runner.ts`
 * (the Prisma/BullMQ/mail-touching half) for the exact reason `currency-rate-sweep.ts` is split
 * from `currency-rate-sweep-runner.ts` (that file's own header): a state transition is a plain
 * function of facts already in hand, testable without a broker, an HTTP call, or a database.
 *
 *  1. Never paid: trial (14d) -> blocked (14d) -> zip sent, zipped (30d) -> deleted.
 *  2. Paid then stopped: active -> past_due -> blocked (14d) -> zip sent, zipped (180d) -> deleted.
 *
 *  1. NEVER-PAID: `trial` (14 days, EVERYTHING allowed except actually sending — see
 *     `send-gate.ts#assertCanSend`) --[trialEndsAt reached]--> `blocked` (14 days, read-only, every
 *     action refused) --[14 days elapse]--> zip sent, `zipped` --[30 days elapse]--> deleted.
 *  2. PAID-THEN-STOPPED: `active` --[the payment provider reports the subscription stopped renewing]-->
 *     `past_due` --[the period the company had ALREADY PAID FOR runs out — see below]--> `blocked`
 *     (14 days) --[14 days elapse]--> zip sent, `zipped` --[180 days elapse]--> deleted.
 *
 * `active` itself is never advanced by this function - becoming `active`/`past_due` is a fact the
 * payment provider reports (Stripe subscription events, through the Better Auth Stripe plugin), not
 * something a periodic sweep can observe on its own; this function only walks a subscription FORWARD
 * once it is already in `trial`, `past_due`, `blocked`, or `zipped`.
 *
 * `past_due` carries no grace window OF ITS OWN (the product brief never named one — the moment payment
 * stops, this treats it as already inside the SAME 14-day countdown the never-paid cycle uses, never
 * a separate/longer grace period a company could exploit by design ambiguity). What it does carry is
 * whatever the company ALREADY BOUGHT: the read-only suspension opens when a paid subscription ENDS
 * (Terms of Service, Section 13.1(b)) — "through cancellation taking effect, non-renewal, or an
 * unresolved payment failure" — and a period paid through the 31st has not ended on the 3rd merely
 * because that month's renewal was refused and the provider is still retrying it. So `past_due` folds into
 * `blocked` on the first tick at or after the end of the period on file (`currentPeriodEnd`, read
 * through `paid-period-grace.ts#isPaidPeriodStillRunning` — the same "a period already paid for is not
 * shortened by something the customer never agreed to" commitment Section 20.2 makes for a Terms
 * change), `blockedAt` stamped `now`, and on the very next tick for a company with no paid period on
 * file at all (a checkout that never completed, a trial that lapsed straight into `past_due`).
 *
 * ## Distinguishing the two cycles' zip→delete delay WITHOUT a dedicated field
 * Both cycles fold into `blocked` and then `zipped` through IDENTICAL code, but the grace period
 * after the zip is sent differs (see the enum's own two cases above). `CompanySubscription.firstPaidAt`
 * is what tells them apart: stamped once, the first time a subscription is paid for, and NEVER cleared
 * afterward, even once the subscription itself is later canceled. So "has this company ever actually
 * paid" is exactly `firstPaidAt !== null`.
 */
import { isPaidPeriodStillRunning } from './paid-period-grace';

/** Same string values as the Prisma enum, so no translation is needed at the boundary. */
export type CompanySubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'BLOCKED' | 'ZIPPED' | 'DELETED';

export interface CompanySubscriptionLifecycleFacts {
  status: CompanySubscriptionStatus;
  trialEndsAt: Date;
  blockedAt: Date | null;
  zipSentAt: Date | null;
  deletionDueAt: Date | null;
  /** The only signal distinguishing the two cycles' zip-to-delete delay. */
  firstPaidAt: Date | null;
  /** The end of the period this company has ALREADY PAID FOR, as last mirrored while the subscription
   *  was live. It is only ever written from a fact that still reports the subscription as paid, so it
   *  can never quietly become the end of an UNPAID cycle the provider rolled the company into on a
   *  failed renewal. `null` for a company that has never paid for one - read only by the `PAST_DUE`
   *  branch below. */
  currentPeriodEnd: Date | null;
}

export const TRIAL_DAYS = 14;
export const BLOCKED_DAYS = 14;
/** Minimum time any company, paid or not, can retrieve its emailed archive before erasure. */
export const MIN_RETRIEVAL_DAYS = 30;
export const PAID_ZIP_GRACE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export type LifecycleAction =
  | { type: 'none' }
  | { type: 'enter_blocked'; blockedAt: Date }
  /** `deletionDueAt` is computed here so the runner never re-derives which cycle applies. */
  | { type: 'send_zip_and_enter_zipped'; zipSentAt: Date; deletionDueAt: Date }
  /** No row is ever persisted as `DELETED`: deleting the `Company` cascades the subscription away. */
  | { type: 'delete_company' };

export function computeLifecycleTransition(
  sub: CompanySubscriptionLifecycleFacts,
  now: Date,
): LifecycleAction {
  switch (sub.status) {
    case 'TRIAL':
      return now.getTime() >= sub.trialEndsAt.getTime()
        ? { type: 'enter_blocked', blockedAt: now }
        : { type: 'none' };

    case 'PAST_DUE':
      // The company keeps the access it paid for until the period ends.
      if (isPaidPeriodStillRunning(sub.currentPeriodEnd, now)) return { type: 'none' };
      return { type: 'enter_blocked', blockedAt: now };

    case 'BLOCKED': {
      if (sub.blockedAt === null) return { type: 'none' };
      const zipDueAt = addDays(sub.blockedAt, BLOCKED_DAYS);
      if (now.getTime() < zipDueAt.getTime()) return { type: 'none' };
      const deletionDueAt =
        sub.firstPaidAt !== null ? addDays(now, PAID_ZIP_GRACE_DAYS) : addDays(now, MIN_RETRIEVAL_DAYS);
      return { type: 'send_zip_and_enter_zipped', zipSentAt: now, deletionDueAt };
    }

    case 'ZIPPED': {
      if (sub.deletionDueAt === null) return { type: 'none' };
      return now.getTime() >= sub.deletionDueAt.getTime() ? { type: 'delete_company' } : { type: 'none' };
    }

    case 'ACTIVE':
    case 'DELETED':
      // `active` only moves via webhook; `deleted` rows no longer exist.
      return { type: 'none' };
  }
}

export function computeTrialWindow(startedAt: Date): { trialStartedAt: Date; trialEndsAt: Date } {
  return { trialStartedAt: startedAt, trialEndsAt: addDays(startedAt, TRIAL_DAYS) };
}

/** J-7 and J-1 owner warnings ahead of the zip and of the permanent deletion. */
export type BillingWarningMilestone = 'blocked_d7' | 'blocked_d1' | 'zipped_d7' | 'zipped_d1';

export interface BillingWarningFacts {
  status: CompanySubscriptionStatus;
  blockedAt: Date | null;
  zipSentAt: Date | null;
  deletionDueAt: Date | null;
}

/**
 * Milestones are checked independently (never `else if`) so a missed tick catches up on all of them.
 * The zipped milestones require a grace window of at least 7 days, so a row with a shorter window does
 * not get an "N days left" warning moments before deletion.
 */
export function computeDueBillingWarnings(sub: BillingWarningFacts, now: Date): BillingWarningMilestone[] {
  const due: BillingWarningMilestone[] = [];

  if (sub.status === 'BLOCKED' && sub.blockedAt) {
    if (now.getTime() >= addDays(sub.blockedAt, 7).getTime()) due.push('blocked_d7');
    if (now.getTime() >= addDays(sub.blockedAt, BLOCKED_DAYS - 1).getTime()) due.push('blocked_d1');
  }

  const hasRealZippedGraceWindow =
    sub.status === 'ZIPPED' &&
    sub.zipSentAt !== null &&
    sub.deletionDueAt !== null &&
    sub.deletionDueAt.getTime() - sub.zipSentAt.getTime() >= 7 * DAY_MS;

  if (hasRealZippedGraceWindow && sub.deletionDueAt) {
    if (now.getTime() >= addDays(sub.deletionDueAt, -7).getTime()) due.push('zipped_d7');
    if (now.getTime() >= addDays(sub.deletionDueAt, -1).getTime()) due.push('zipped_d1');
  }

  return due;
}
