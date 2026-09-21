/**
 * The pure shape of `GET /api/billing/status` — split out from `billing.controller.ts` so the
 * "which date does 'days remaining' count down to, per status" decision is testable without booting
 * Nest (the same "pure core, thin controller shell" split every other billing file holds).
 */
import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { CompanyCustomerFacts } from './legacy-customer';
import { addDays, BLOCKED_DAYS } from './lifecycle';
import { paidThroughEndOfDay } from './paid-period-grace';

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
   *  own 14-day zip deadline, zipped's own deletion date. `null` for ACTIVE (a paying company with
   *  nothing counting down) and for a defensively-incomplete row (e.g. BLOCKED with no `blockedAt`,
   *  which should never happen). For PAST_DUE it counts down to the end of the period the company has
   *  ALREADY PAID FOR — the very date `lifecycle.ts`'s own `PAST_DUE` branch will block it on — so the
   *  screen states the real deadline a customer whose card was refused has to fix it, rather than
   *  understating it. `0`, never `null`, once (or when) no paid period is left: `past_due` carries no
   *  window of its own beyond what was bought, so the block lands on the very next sweep tick, and
   *  `null` would read as "nothing urgent" to a company that can be locked out within the hour; `0`
   *  reuses the same "day(s) remaining" wording the screen already renders for every other status. */
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
  /** `true` when this company already has its OWN, company-scoped Polar customer (`legacy-customer.ts`'s
   *  own `getCompanyCustomerFacts`) — `false` for a company that has never touched billing yet (a fresh
   *  TRIAL, or one `customer-provisioning.ts`'s boot/sweep sync has not yet reached or could not create
   *  a customer for, e.g. a taken billing email). `billing.settings.tsx` uses this to decide whether
   *  "Manage subscription" can even be shown — a concrete 2026-09-16 dev-instance incident proved a
   *  company WITHOUT one still saw that button, and clicking it surfaced `portal-session.ts`'s own raw
   *  `PolarCustomerNotFoundError` message verbatim instead of a translated notice. */
  hasCompanyCustomer: boolean;
  /** `true` when this company's stored subscription still points at the pre-2026-09-16 per-USER Polar
   *  customer (`legacy-customer.ts`'s own header) rather than this company's own. There is no automatic
   *  migration — the settings screen shows a plain re-subscribe notice instead of trying. */
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
    // The SAME boundary the sweep suspends on, never a second definition of it — see this view's own
    // field comment, and `paid-period-grace.ts` for why that boundary is a calendar day.
    const paidThrough = paidThroughEndOfDay(sub.currentPeriodEnd);
    daysRemaining = paidThrough === null ? 0 : daysUntil(paidThrough, now);
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
    hasCompanyCustomer: facts.hasCompanyCustomer,
    legacySubscription: facts.legacySubscription,
  };
}
