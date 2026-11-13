/** Pure shape of `GET /api/billing/status`, testable without booting Nest. */
import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { CompanyCustomerFacts } from './legacy-customer';
import { addDays, BLOCKED_DAYS } from './lifecycle';
import { paidThroughEndOfDay } from './paid-period-grace';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Floored at 0, rounded up so "23 hours left" reads as 1 day. */
function daysUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS));
}

export interface BillingStatusView {
  status: CompanySubscription['status'];
  seats: number;
  interval: CompanySubscription['interval'];
  trialEndsAt: string;
  /** Counts down to the next boundary for the current status; `null` for ACTIVE or an incomplete row.
   *  For PAST_DUE it is the end of the paid period, and `0` (not `null`) once none is left, since the
   *  block lands on the next sweep tick and `null` would read as nothing urgent. */
  daysRemaining: number | null;
  /** This app's own route; the active company is resolved server-side, never from the client. */
  checkoutUrl: string;
  /** This app's own route, not better-auth's portal, which cannot serve team customers. */
  portalUrl: string;
  /** PAST_DUE because a seat increase's proration charge failed, and no newer Polar fact has landed
   *  since, so a stale seat failure never masks an unrelated, more recent cause. */
  seatPaymentFailureExplainsStatus: boolean;
  /** Whether the company has its own Polar customer; gates the "Manage subscription" button. */
  hasCompanyCustomer: boolean;
  /** The stored subscription still points at a pre-migration per-user customer; there is no automatic
   *  migration, so the screen asks to re-subscribe. */
  legacySubscription: boolean;
}

export function computeBillingStatusView(
  sub: CompanySubscription,
  facts: CompanyCustomerFacts,
  now: Date = new Date(),
): BillingStatusView {
  let daysRemaining: number | null = null;
  if (sub.status === 'TRIAL') {
    daysRemaining = daysUntil(sub.trialEndsAt, now);
  } else if (sub.status === 'PAST_DUE') {
    // The same boundary the sweep suspends on; see `paid-period-grace.ts` for why it is a calendar day.
    const paidThrough = paidThroughEndOfDay(sub.currentPeriodEnd);
    daysRemaining = paidThrough === null ? 0 : daysUntil(paidThrough, now);
  } else if (sub.status === 'BLOCKED' && sub.blockedAt) {
    daysRemaining = daysUntil(addDays(sub.blockedAt, BLOCKED_DAYS), now);
  } else if (sub.status === 'ZIPPED' && sub.deletionDueAt) {
    daysRemaining = daysUntil(sub.deletionDueAt, now);
  }

  // A seat failure only explains PAST_DUE if no newer general Polar fact has landed since.
  const seatPaymentFailureExplainsStatus =
    sub.status === 'PAST_DUE' &&
    sub.seatPaymentFailedAt !== null &&
    (sub.lastPolarFactAt === null || sub.seatPaymentFailedAt.getTime() >= sub.lastPolarFactAt.getTime());

  return {
    status: sub.status,
    seats: sub.seats,
    interval: sub.interval,
    trialEndsAt: sub.trialEndsAt.toISOString(),
    daysRemaining,
    checkoutUrl: '/api/billing/checkout',
    portalUrl: '/api/billing/portal',
    seatPaymentFailureExplainsStatus,
    hasCompanyCustomer: facts.hasCompanyCustomer,
    legacySubscription: facts.legacySubscription,
  };
}
