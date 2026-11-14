/**
 * Mirrors a Stripe subscription onto the company's own `CompanySubscription` row, from the hooks the
 * `@better-auth/stripe` plugin calls after it has written its own `subscription` row
 * (`stripe-plugin.ts#subscriptionSyncHooks`). This is the ONLY way a company becomes `ACTIVE`, and
 * the only way it leaves `ACTIVE` (`lifecycle.ts` never moves an `ACTIVE` row on its own).
 *
 * What a fact writes:
 *  - `status`: Stripe `active`/`trialing` is `ACTIVE`, every other status (`past_due`, `unpaid`,
 *    `canceled`, `incomplete`, `incomplete_expired`, `paused`) is `PAST_DUE`. From `PAST_DUE`,
 *    `lifecycle.ts` takes over: read-only once `currentPeriodEnd` is over, then zip, then deletion.
 *  - `seats`: the subscription quantity, as the plugin already resolved it on its own row.
 *  - `interval`: the billing cadence of the plan price (`month`/`year`).
 *  - `currentPeriodEnd`: only from a fact that still reports the subscription as paid. A `past_due`
 *    fact can carry the end of a period nobody has paid for, and both `lifecycle.ts` and
 *    `paid-period-grace.ts` hand out access on the strength of this date.
 *  - `firstPaidAt`: stamped by the first `ACTIVE` fact, never cleared. It is what tells the
 *    never-paid cycle from the paid-then-stopped one (`lifecycle.ts`).
 *  - `lastBillingFactAt`: the Stripe event's own `created` time. Stripe gives no delivery-order
 *    guarantee, so a fact older than the last one applied is dropped.
 *  - an `ACTIVE` fact clears `blockedAt`/`zipSentAt`/`deletionDueAt`: a company that pays again is
 *    out of the suspension and deletion clocks.
 *  - `founderLostAt`: stamped by the `canceled` fact of a founder-plan subscription while the company
 *    holds the founder grid (`founder-grid.ts`). Also written when the rest of the fact is held back
 *    for a suspended company: a suspended founder whose subscription ends has still been interrupted.
 *
 * Two kinds of non-paid fact are held back without writing anything, not even `lastBillingFactAt`
 * (a watermark planted by a fact that changed nothing would later reject the still-pending,
 * chronologically older `active` fact of the same checkout as stale):
 *  - a company still inside its own valid trial: an abandoned checkout (`incomplete`, then
 *    `incomplete_expired`) must never cut that trial short;
 *  - a company already `BLOCKED` or `ZIPPED`: moving it back to `PAST_DUE` would reopen writes and
 *    restart its 14-day clock.
 * And one more: a non-paid fact about one subscription while the same company has ANOTHER
 * subscription that is active or trialing (an old subscription's late `deleted` event after the
 * company subscribed again) says nothing about whether the company pays.
 *
 * Never throws for a company that no longer exists (a `deleted` event sent after
 * `deletion.ts#cancelCompanyStripeSubscriptions` cancelled it): there is nothing left to update.
 */
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

import {
  CompanySubscriptionInterval,
  CompanySubscriptionStatus,
} from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription, lockCompanySubscriptionRow } from './company-subscription.store';
import { endsFounderGrid, holdsFounderGrid } from './founder-grid';

/** The plugin's own `subscription` row fields this module reads. */
export interface PluginSubscriptionRow {
  id: string;
  referenceId: string;
  status: string;
  plan?: string | null;
  seats?: number | null;
  billingInterval?: string | null;
  periodEnd?: Date | null;
}

/** What one hook call hands over: the plugin row just written, and the Stripe event behind it. */
export interface StripeSubscriptionHookData {
  event: { created: number };
  subscription: PluginSubscriptionRow;
}

export interface StripeSubscriptionFacts {
  companyId: string;
  pluginSubscriptionId: string;
  status: Extract<CompanySubscriptionStatus, 'ACTIVE' | 'PAST_DUE'>;
  /** The Stripe status as reported, and the plugin plan name: what `founder-grid.ts` reads. */
  stripeStatus: string;
  plan: string | undefined;
  seats: number | undefined;
  interval: CompanySubscriptionInterval | undefined;
  currentPeriodEnd: Date | undefined;
  factAt: Date;
}

const PAID_STRIPE_STATUSES = new Set(['active', 'trialing']);

export function mapStripeSubscriptionStatus(status: string): 'ACTIVE' | 'PAST_DUE' {
  return PAID_STRIPE_STATUSES.has(status) ? 'ACTIVE' : 'PAST_DUE';
}

export function mapStripeInterval(
  interval: string | null | undefined,
): CompanySubscriptionInterval | undefined {
  if (interval === 'month') return 'MONTH';
  if (interval === 'year') return 'YEAR';
  return undefined;
}

export function toStripeSubscriptionFacts({
  event,
  subscription,
}: StripeSubscriptionHookData): StripeSubscriptionFacts {
  const seats = subscription.seats;
  return {
    companyId: subscription.referenceId,
    pluginSubscriptionId: subscription.id,
    status: mapStripeSubscriptionStatus(subscription.status),
    stripeStatus: subscription.status,
    plan: subscription.plan ?? undefined,
    seats: typeof seats === 'number' && Number.isInteger(seats) && seats >= 1 ? seats : undefined,
    interval: mapStripeInterval(subscription.billingInterval),
    currentPeriodEnd: subscription.periodEnd ?? undefined,
    factAt: new Date(event.created * 1000),
  };
}

async function companyHasOtherPaidSubscription(
  companyId: string,
  pluginSubscriptionId: string,
): Promise<boolean> {
  const other = await prisma.subscription.findFirst({
    where: {
      referenceId: companyId,
      id: { not: pluginSubscriptionId },
      status: { in: [...PAID_STRIPE_STATUSES] },
    },
    select: { id: true },
  });
  return other !== null;
}

export type StripeFactOutcome = 'applied' | 'stale' | 'held_back' | 'no_company';

export async function applyStripeSubscriptionFacts(
  facts: StripeSubscriptionFacts,
  now: Date = new Date(),
): Promise<StripeFactOutcome> {
  const { companyId } = facts;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) {
    logger.info('Stripe subscription fact for a company that no longer exists. Ignored.', {
      category: 'billing',
      details: { companyId, pluginSubscriptionId: facts.pluginSubscriptionId },
    });
    return 'no_company';
  }

  if (
    facts.status === 'PAST_DUE' &&
    (await companyHasOtherPaidSubscription(companyId, facts.pluginSubscriptionId))
  ) {
    return 'held_back';
  }

  // The row must exist before it can be locked (`lockCompanySubscriptionRow`'s own header).
  await getOrCreateCompanySubscription(companyId, now);

  return prisma.$transaction(async (tx) => {
    // Locked so two facts for the same company (Stripe sends `updated` and `deleted` within the same
    // second) cannot both pass the staleness check against the same watermark.
    await lockCompanySubscriptionRow(tx, companyId);
    const sub = await tx.companySubscription.findUniqueOrThrow({ where: { companyId } });

    if (sub.lastBillingFactAt && facts.factAt.getTime() < sub.lastBillingFactAt.getTime()) {
      logger.warn('Ignored a stale Stripe subscription fact, a fresher one was already applied', {
        category: 'billing',
        companyId,
        details: { companyId, factAt: facts.factAt, lastBillingFactAt: sub.lastBillingFactAt },
      });
      return 'stale';
    }

    const losesFounderGrid = endsFounderGrid(facts) && holdsFounderGrid(sub);
    const founderLoss = losesFounderGrid ? { founderLostAt: facts.factAt } : {};

    const stillInsideOwnTrial = sub.status === 'TRIAL' && now.getTime() < sub.trialEndsAt.getTime();
    const alreadySuspended = sub.status === 'BLOCKED' || sub.status === 'ZIPPED';
    if (facts.status === 'PAST_DUE' && (stillInsideOwnTrial || alreadySuspended)) {
      if (losesFounderGrid) await tx.companySubscription.update({ where: { companyId }, data: founderLoss });
      return 'held_back';
    }

    const paid = facts.status === 'ACTIVE';
    await tx.companySubscription.update({
      where: { companyId },
      data: {
        status: facts.status,
        lastBillingFactAt: facts.factAt,
        ...(facts.seats !== undefined ? { seats: facts.seats } : {}),
        ...(facts.interval ? { interval: facts.interval } : {}),
        ...(paid && facts.currentPeriodEnd ? { currentPeriodEnd: facts.currentPeriodEnd } : {}),
        ...(paid && sub.firstPaidAt === null ? { firstPaidAt: facts.factAt } : {}),
        ...(paid ? { blockedAt: null, zipSentAt: null, deletionDueAt: null } : {}),
        ...founderLoss,
      },
    });
    return 'applied';
  });
}

/** The one entry point the plugin hooks call. */
export async function syncStripeSubscription(data: StripeSubscriptionHookData): Promise<StripeFactOutcome> {
  return applyStripeSubscriptionFacts(toStripeSubscriptionFacts(data));
}
