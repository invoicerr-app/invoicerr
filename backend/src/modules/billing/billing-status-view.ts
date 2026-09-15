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
  /** The better-auth route the frontend POSTs to start a checkout — see `polar-plugin.ts`'s own
   *  header for why this is a raw path, not a link this controller can meaningfully "generate": the
   *  frontend supplies its own `products`/`referenceId`/`successUrl` in the request body. */
  checkoutUrl: string;
  /** The better-auth route the frontend POSTs (or GETs) to reach the Polar customer portal. */
  portalUrl: string;
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

  return {
    status: sub.status,
    seats: sub.seats,
    interval: sub.interval,
    trialEndsAt: sub.trialEndsAt.toISOString(),
    daysRemaining,
    checkoutUrl: '/api/auth/checkout',
    portalUrl: '/api/auth/customer/portal',
  };
}
