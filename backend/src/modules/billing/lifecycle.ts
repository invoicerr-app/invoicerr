/**
 * Pure lifecycle decisions; the side-effecting half is `billing-lifecycle-sweep-runner.ts`.
 *
 *  1. Never paid: trial (14d) -> blocked (14d) -> zip sent, zipped (30d) -> deleted.
 *  2. Paid then stopped: active -> past_due -> blocked (14d) -> zip sent, zipped (180d) -> deleted.
 *
 * `active`/`past_due` are entered only via webhooks. `past_due` has no grace window of its own, but
 * is not blocked until the period already paid for ends (Terms of Service, Section 13.1(b)).
 *
 * "Ever paid" is `polarSubscriptionId !== null`: it is set once at checkout and never cleared.
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
  polarSubscriptionId: string | null;
  /** End of the period already paid for; only written from facts reporting the subscription as paid,
   *  so it never becomes the end of an unpaid cycle after a failed renewal. */
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
        sub.polarSubscriptionId !== null
          ? addDays(now, PAID_ZIP_GRACE_DAYS)
          : addDays(now, MIN_RETRIEVAL_DAYS);
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

export type RecoveredNonActiveStatus = 'TRIAL' | 'PAST_DUE' | 'BLOCKED';

export interface RecoveredLifecycleState {
  status: RecoveredNonActiveStatus;
  /** Backdated to `anchor`, never `now`, so the sweep computes the same deadline it would have. */
  blockedAt: Date | null;
}

/**
 * Recomputes status for a company known to have no live Polar subscription, anchored at when that
 * became true rather than trusting the stored (possibly stale) status. A company still inside its
 * original trial keeps its unused trial days.
 */
export function computeRecoveredStatus(trialEndsAt: Date, anchor: Date, now: Date): RecoveredLifecycleState {
  if (now.getTime() < trialEndsAt.getTime()) return { status: 'TRIAL', blockedAt: null };

  const zipDueAt = addDays(anchor, BLOCKED_DAYS);
  if (now.getTime() >= zipDueAt.getTime()) return { status: 'BLOCKED', blockedAt: anchor };
  return { status: 'PAST_DUE', blockedAt: null };
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
