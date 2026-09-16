/**
 * The pure shape of `GET /api/billing/status` — split out from `billing.controller.ts` so the
 * "which date does 'days remaining' count down to, per status" decision is testable without booting
 * Nest (the same "pure core, thin controller shell" split every other billing file holds).
 */
import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { addDays, BLOCKED_DAYS } from './lifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days remaining until `target`, floored at 0 (never negative — a boundary already passed
 *  reads as "0 days left", not a confusing negative countdown; the lifecycle SWEEP, not this display
 *  value, is what actually advances the status once that happens). Rounds UP (`ceil`) so "23 hours
 *  left" reads as "1 day", not "0 days" — the more honest direction to round a countdown a human is
 *  about to act on. */
function daysUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS));
}

export interface BillingStatusView {
  status: CompanySubscription['status'];
  seats: number;
  interval: CompanySubscription['interval'];
  trialEndsAt: string;
  /** Counts down to whatever date NEXT matters for the CURRENT status — trial's own end, blocked's
   *  own 14-day zip deadline, zipped's own deletion date. `null` for ACTIVE/PAST_DUE (nothing here is
   *  counting down for a currently-paying — or currently-still-billed — company) and for a
   *  defensively-incomplete row (e.g. BLOCKED with no `blockedAt`, which should never happen). */
  daysRemaining: number | null;
  /** This app's OWN route (`billing.controller.ts`'s `POST /billing/checkout`) — not a link this
   *  controller can meaningfully "generate": the frontend supplies its own `slug`/`successUrl`/
   *  `returnUrl` in the request body, and the ACTIVE COMPANY is resolved server-side
   *  (`@ActiveCompany()`), never from a client-supplied id (option A, `checkout-session.ts`'s own
   *  header). */
  checkoutUrl: string;
  /** This app's OWN route (`billing.controller.ts`'s `POST /billing/portal`) — NOT better-auth's own
   *  `/api/auth/customer/portal`, which cannot open a session for this product's TEAM customers (see
   *  `portal-session.ts`'s header). */
  portalUrl: string;
  /** `true` only when this company is `PAST_DUE` AND its OWN `seatPaymentFailedAt` is the reason —
   *  `seat-sync.ts`'s own header on the recognized Polar `PaymentError`/`PaymentFailed` refusal a seat
   *  INCREASE's immediate-proration charge can get back. Lets the Billing page say "the payment for
   *  the extra seat you added failed" instead of the generic "your subscription is past due" — but
   *  ONLY while that really is still the most likely explanation: a company that fell PAST_DUE for an
   *  entirely different reason (the whole subscription lapsed) AFTER a stale, unrelated seat failure
   *  from days earlier must not show a misleading, out-of-date cause. */
  seatPaymentFailureExplainsStatus: boolean;
}

export function computeBillingStatusView(
  sub: CompanySubscription,
  now: Date = new Date(),
): BillingStatusView {
  let daysRemaining: number | null = null;
  if (sub.status === 'TRIAL') {
    daysRemaining = daysUntil(sub.trialEndsAt, now);
  } else if (sub.status === 'BLOCKED' && sub.blockedAt) {
    daysRemaining = daysUntil(addDays(sub.blockedAt, BLOCKED_DAYS), now);
  } else if (sub.status === 'ZIPPED' && sub.deletionDueAt) {
    daysRemaining = daysUntil(sub.deletionDueAt, now);
  }

  // The seat failure only still EXPLAINS the current PAST_DUE status if no NEWER general Polar fact
  // (a webhook, or a `status-reconcile.ts` repair read — both stamp `lastPolarFactAt`) has landed
  // since — see this view's own field comment on why a stale seat-specific reason must not survive an
  // unrelated, more recent cause.
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
  };
}
