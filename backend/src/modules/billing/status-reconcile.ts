/**
 * Repair path for `GET /api/billing/status` when the webhook that should have updated the row never
 * landed: webhook failures (e.g. signature rejections) are visible only in Polar's own delivery log.
 * A billable subscription is applied through the same `applySubscriptionWebhook` a webhook would use.
 *
 * An ACTIVE row is re-checked too: if the company's own customer has no subscription at all (e.g. its
 * pre-migration per-user customer was deleted, whose webhook resolves to no company), the status is
 * recomputed instead of staying ACTIVE forever. Cached per company so an open dashboard polling
 * status cannot hot-loop the Polar API.
 */
import { logger } from '@/logger/logger.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import {
  getOrCreateCompanySubscription,
  recomputeStatusForVanishedSubscription,
} from './company-subscription.store';
import { getPolarClient } from './polar-client';
import { applySubscriptionWebhook } from './webhook-handlers';

const RECONCILE_CACHE_MS = 5 * 60 * 1000;

/** Process-local; a multi-replica deployment just re-checks a little more often. */
const lastCheckedAtByCompanyId = new Map<string, number>();

export function resetStatusReconcileCacheForTests(): void {
  lastCheckedAtByCompanyId.clear();
}

/** Wire snake_case fields read from a Polar `Subscription`. `modified_at` becomes `factAt` so the
 *  staleness check can drop this read if a fresher webhook already landed. */
interface ReconcileSubscriptionFacts {
  id: string;
  customer_id: string;
  status: string;
  recurring_interval: string;
  metadata: Record<string, string | number | boolean>;
  modified_at?: string | Date | null;
  created_at?: string | Date | null;
  /** Used only for ordering, never threaded into `applySubscriptionWebhook`. */
  started_at?: string | Date | null;
  current_period_end?: Date | null;
}

/** Structurally typed subset of the Polar SDK client, so specs can pass a plain fake. */
export interface ReconcileSubscriptionsClient {
  subscriptions: {
    list(query: {
      external_customer_id: string;
      limit: number;
      sorting: string[];
    }): Promise<{ items: ReconcileSubscriptionFacts[] }>;
  };
}

/** Most recently started first, falling back to created date then `id` for a total order; a missing
 *  date sorts last. */
function byRecencyDesc(a: ReconcileSubscriptionFacts, b: ReconcileSubscriptionFacts): number {
  const at = (sub: ReconcileSubscriptionFacts) => {
    const value = sub.started_at ?? sub.created_at;
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
  };
  return at(b) - at(a) || a.id.localeCompare(b.id);
}

/**
 * Filtered by `external_customer_id` (= company.id), never the stored `polarCustomerId`, which could
 * be a pre-migration per-user customer shared across companies. `sorting` has no documented default,
 * so it is requested server-side (to rank beyond this page) and redone locally: picking an old
 * cancelled subscription would downgrade a company no webhook ever reached to PAST_DUE.
 */
async function findMostRecentSubscription(
  client: ReconcileSubscriptionsClient,
  companyId: string,
): Promise<ReconcileSubscriptionFacts | undefined> {
  const { items } = await client.subscriptions.list({
    external_customer_id: companyId,
    limit: 10,
    sorting: ['-started_at'],
  });
  if (items.length === 0) return undefined;
  return [...items].sort(byRecencyDesc)[0];
}

/**
 * At most once per `RECONCILE_CACHE_MS` per company, and only once a `polarCustomerId` exists. Never
 * throws: a Polar outage must not turn `GET /api/billing/status` into a 500.
 */
export async function reconcileFromPolarIfStale(
  sub: CompanySubscription,
  client: ReconcileSubscriptionsClient = getPolarClient() as unknown as ReconcileSubscriptionsClient,
  now: number = Date.now(),
): Promise<CompanySubscription> {
  if (!sub.polarCustomerId) return sub;

  const lastCheckedAt = lastCheckedAtByCompanyId.get(sub.companyId);
  if (lastCheckedAt !== undefined && now - lastCheckedAt < RECONCILE_CACHE_MS) return sub;
  lastCheckedAtByCompanyId.set(sub.companyId, now);

  try {
    const latest = await findMostRecentSubscription(client, sub.companyId);

    if (latest) {
      const factTimestamp = latest.modified_at ?? latest.created_at;

      await applySubscriptionWebhook({
        companyId: sub.companyId,
        polarSubscriptionId: latest.id,
        polarCustomerId: latest.customer_id,
        status: latest.status,
        recurringInterval: latest.recurring_interval,
        currentPeriodEnd: latest.current_period_end ?? undefined,
        // `undefined` when Polar reports no timestamp: applies unconditionally rather than comparing.
        factAt: factTimestamp ? new Date(factTimestamp) : undefined,
      });

      return await getOrCreateCompanySubscription(sub.companyId);
    }

    // No subscription is normal for any non-ACTIVE status (the sweep owns those); only an ACTIVE row
    // is wrong here, e.g. one left over from a deleted pre-migration customer.
    if (sub.status !== 'ACTIVE') return sub;

    logger.warn(
      'Polar status reconcile: company was ACTIVE but its own company-scoped customer has no ' +
        'subscription at all, recomputing (likely a stale row from a deleted pre-migration customer)',
      { category: 'billing', companyId: sub.companyId, details: { companyId: sub.companyId } },
    );
    const anchor = sub.lastPolarFactAt ?? new Date(now);
    return await recomputeStatusForVanishedSubscription(
      sub.companyId,
      sub.trialEndsAt,
      anchor,
      new Date(now),
    );
  } catch (error) {
    logger.warn('Polar status reconcile failed, the local row is unchanged, next request will retry', {
      category: 'billing',
      companyId: sub.companyId,
      details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
    });
    return sub;
  }
}
