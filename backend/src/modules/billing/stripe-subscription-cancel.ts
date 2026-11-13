/**
 * Cancels every Stripe subscription a company still has, right before the company is deleted
 * (`deletion.ts`, both the lifecycle sweep and the OWNER's own "Delete company"). A deleted company
 * must never keep being charged: the plugin's `subscription` rows carry no foreign key to `Company`,
 * so nothing else would ever stop them.
 *
 * Runs BEFORE the deletion transaction and throws when a cancellation fails, so the company is only
 * deleted once Stripe has stopped billing it. The sweep retries on its next tick; the OWNER sees the
 * deletion fail and can retry. The reverse order (delete, then cancel) could leave a subscription
 * charging a company that no longer exists, with no row left to retry from.
 *
 * Cancelled immediately (no `cancel_at_period_end`): the company and its data are gone, there is no
 * period left to serve. Stripe then sends `customer.subscription.deleted`, which
 * `stripe-subscription-sync.ts` ignores because the company no longer exists.
 */
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

import { isBillingEnabled } from './billing-flag';
import { stripeClientFor } from './stripe-client';

/** The two Stripe calls this module makes, typed narrowly so a spec can pass a fake. */
export interface StripeSubscriptionsApi {
  cancel(id: string): Promise<unknown>;
  retrieve(id: string): Promise<{ status: string }>;
}

// Statuses Stripe can still charge, or move back to charging. `canceled` and `incomplete_expired`
// are final.
const CANCELLABLE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'];
const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired']);

export async function cancelCompanyStripeSubscriptions(
  companyId: string,
  injectedApi?: StripeSubscriptionsApi,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (!isBillingEnabled(env)) return 0;

  const rows = await prisma.subscription.findMany({
    where: {
      referenceId: companyId,
      stripeSubscriptionId: { not: null },
      status: { in: CANCELLABLE_STATUSES },
    },
    select: { stripeSubscriptionId: true },
  });
  if (rows.length === 0) return 0;

  // The Stripe client is only built once there is something to cancel: an instance without a key
  // must still be able to delete a company.
  let api = injectedApi;
  if (!api) {
    if ((env.STRIPE_SECRET_KEY ?? '').trim() === '') {
      logger.warn('Stripe is not configured, the company is deleted without cancelling its subscriptions', {
        category: 'billing',
        companyId,
        details: { companyId, subscriptions: rows.length },
      });
      return 0;
    }
    api = stripeClientFor(env).subscriptions;
  }

  let cancelled = 0;
  for (const { stripeSubscriptionId } of rows) {
    const id = stripeSubscriptionId as string;
    try {
      await api.cancel(id);
      cancelled++;
    } catch (error) {
      // The local row can lag behind Stripe (its `deleted` event not delivered yet): cancelling a
      // subscription that already ended is an error on Stripe's side, but the goal is already met.
      const current = await api.retrieve(id).catch(() => null);
      if (current && ENDED_STATUSES.has(current.status)) continue;
      logger.error('Could not cancel a Stripe subscription before deleting its company', {
        category: 'billing',
        companyId,
        details: {
          companyId,
          stripeSubscriptionId: id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
  return cancelled;
}
