/**
 * The pure shape of `GET /api/billing/status` — split out from `billing.controller.ts` so the
 * "which date does 'days remaining' count down to, per status" decision is testable without booting
 * Nest (the same "pure core, thin controller shell" split every other billing file holds).
 */
import { CompanySubscription } from '../../../prisma/generated/prisma/client';
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
}

export function computeBillingStatusView(
  sub: CompanySubscription,
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

  return {
    status: sub.status,
    seats: sub.seats,
    interval: sub.interval,
    trialEndsAt: sub.trialEndsAt.toISOString(),
    daysRemaining,
  };
}
