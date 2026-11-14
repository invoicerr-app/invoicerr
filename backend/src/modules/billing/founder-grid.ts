/**
 * The founder price grid (#760, #971 slice 7): a separate grid applied to specific companies, kept for
 * as long as they renew without interruption.
 *
 * - Granted per company by the operator (`grantFounderGrid`, `pnpm billing:grant-founder <companyId>`).
 *   Pre-orders will grant it on their own in a later step (slice 8).
 * - Held while `founderGrantedAt` is set and `founderLostAt` is not. Only a holder may check out on the
 *   founder plan (`stripe-plugin.ts#canActOnCompanySubscription`); the frontend picks the plan from
 *   `GET /api/billing/status` (`priceGrid`).
 * - Lost for good the first time a founder-plan subscription of the company ends: Stripe `canceled`
 *   (`stripe-subscription-sync.ts`). A failed payment (`past_due`, `unpaid`) is not an interruption
 *   while Stripe still retries it, and neither is a cancellation scheduled for the period end and
 *   withdrawn before it. An abandoned checkout (`incomplete_expired`) never started, so it is not one
 *   either. Switching between the monthly and yearly founder prices keeps the grid.
 * - A loss is never undone by the code: granting again after a loss is refused.
 */
import prisma from '@/prisma/prisma.service';

import { getOrCreateCompanySubscription } from './company-subscription.store';
import type { PriceGrid } from './stripe-price-catalog';

export const FOUNDER_PLAN = 'founder';

export interface FounderGridState {
  founderGrantedAt: Date | null;
  founderLostAt: Date | null;
}

export function holdsFounderGrid(state: FounderGridState): boolean {
  return state.founderGrantedAt !== null && state.founderLostAt === null;
}

export function priceGridOf(state: FounderGridState): PriceGrid {
  return holdsFounderGrid(state) ? 'founder' : 'standard';
}

/**
 * Whether a subscription fact ends the founder grid: a founder-plan subscription that Stripe reports
 * as `canceled`, the only status a started subscription ends in.
 */
export function endsFounderGrid(fact: { plan?: string | null; stripeStatus: string }): boolean {
  return fact.plan?.toLowerCase() === FOUNDER_PLAN && fact.stripeStatus === 'canceled';
}

export async function companyHoldsFounderGrid(companyId: string): Promise<boolean> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { founderGrantedAt: true, founderLostAt: true },
  });
  return sub !== null && holdsFounderGrid(sub);
}

export type GrantFounderOutcome = 'granted' | 'already_held' | 'lost' | 'no_company';

export async function grantFounderGrid(
  companyId: string,
  now: Date = new Date(),
): Promise<GrantFounderOutcome> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return 'no_company';
  const sub = await getOrCreateCompanySubscription(companyId, now);
  if (sub.founderLostAt !== null) return 'lost';
  if (sub.founderGrantedAt !== null) return 'already_held';
  const { count } = await prisma.companySubscription.updateMany({
    where: { companyId, founderGrantedAt: null, founderLostAt: null },
    data: { founderGrantedAt: now },
  });
  return count === 1 ? 'granted' : 'already_held';
}
