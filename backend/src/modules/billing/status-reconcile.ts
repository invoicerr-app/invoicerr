/**
 * Repair path for `GET /api/billing/status` when the LOCAL `CompanySubscription` row is stale because
 * the webhook delivery that should have updated it never landed — `webhook-handlers.ts` is otherwise
 * the ONLY writer of a real Polar status, and a concrete 2026-09-15 sandbox incident proved that path
 * can fail silently end-to-end: every one of 18 delivery attempts for a real paid subscription came
 * back `400 "No matching signature found"` — visible only in Polar's OWN delivery log, never in this
 * app's logs (the signature check happened inside `@polar-sh/sdk/webhooks`, before
 * `webhook-handlers.ts` ever ran) — and the company's own `GET /api/billing/status` kept answering
 * `TRIAL` indefinitely with no way to self-heal.
 *
 * CORRECTED same day: the ORIGINAL diagnosis here blamed a stale `POLAR_WEBHOOK_SECRET` baked into a
 * redeployed container's process env (a `docker restart`, not a compose recreate, does not re-read
 * `.env`). That was never it — reading `@polar-sh/sdk`'s own `dist/commonjs/webhooks.js` line by line
 * against a captured real delivery found `validateEvent` derives the WRONG HMAC key for ANY
 * `whsec_`-prefixed secret, stale or fresh (it base64-re-encodes the whole secret string before
 * handing it to `standardwebhooks#Webhook`, ending up using the secret's own literal UTF-8 bytes as
 * the key) — see `modules/billing/polar-webhook.controller.ts`'s own header for the full account. The
 * "stale secret" theory fit the same observed symptom (18/18 failures, identical error message) but
 * was never actually tested against a real capture; this file's own repair path is unaffected either
 * way — it never depended on which theory was right, only on webhooks being able to fail silently at
 * all. The fix is `polar-webhook.controller.ts`'s own signature verification, not this file.
 *
 * This is a REPAIR path, not a replacement for the webhook: it only fires when there is already a
 * `polarCustomerId` to reconcile FROM (a company that never reached Polar at all has nothing to check)
 * and the locally-stored status is not already `ACTIVE`. `reconcileFromPolar` reads the customer's
 * subscriptions straight back from Polar and, if one is billable, applies it through the exact same
 * `applySubscriptionWebhook` a real webhook would have used — so a repaired row is indistinguishable
 * from one the webhook had updated correctly. Cached per company for `RECONCILE_CACHE_MS` so a
 * dashboard tab left open polling `/billing/status` cannot turn into a Polar API hot loop; a company
 * that stays TRIAL/PAST_DUE for real (never actually resolved) simply gets re-checked, cheaply, on
 * every cache expiry — never a persistent extra cost once the row is genuinely ACTIVE (this whole
 * module is skipped from then on).
 */
import { logger } from '@/logger/logger.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { getPolarClient } from './polar-client';
import { applySubscriptionWebhook } from './webhook-handlers';

const RECONCILE_CACHE_MS = 5 * 60 * 1000;

/** Module-level, process-local — same "best-effort, never a source of truth on its own" spirit as
 *  `polar-client.ts`'s own cached client; a multi-instance deployment simply re-checks slightly more
 *  often than one replica alone would, never incorrectly (there is no shared state to get wrong). */
const lastCheckedAtByCompanyId = new Map<string, number>();

export function resetStatusReconcileCacheForTests(): void {
  lastCheckedAtByCompanyId.clear();
}

/** The subset of a Polar `Subscription` this module actually reads — the same fields
 *  `webhook-handlers.ts`'s own `PolarSubscriptionWebhookFacts` carries, before mapping. */
interface ReconcileSubscriptionFacts {
  id: string;
  customerId: string;
  status: string;
  recurringInterval: string;
  metadata: Record<string, string | number | boolean>;
}

/** Structurally typed subset of the `Polar` SDK client this function actually calls — see
 *  `seat-sync.spec.ts`/`portal-session.ts`'s own narrow client shapes for the same pattern. */
export interface ReconcileSubscriptionsClient {
  subscriptions: {
    list(request: {
      externalCustomerId: string;
      limit: number;
    }): Promise<AsyncIterable<{ result: { items: ReconcileSubscriptionFacts[] } }>>;
  };
}

/** The most recently created subscription for this COMPANY, Polar-side — filtered by
 *  `externalCustomerId` (= `company.id` under option A, `billing-customer.ts`'s own header), never by
 *  the locally-stored `polarCustomerId`: this is the fix for a bug this feature's own research found
 *  in the pre-option-A code (a shared per-USER customer meant `items[0]` here could belong to a
 *  DIFFERENT company owned by the same user) — under option A every company has its own dedicated
 *  Polar customer, so this filter is now also strictly correct rather than merely defense in depth.
 *  `subscriptions.list` has no "most recent only" shortcut, so this just reads the (small,
 *  page-1-sized for a per-company customer) list and takes the first item; a customer with no
 *  subscription at all (checkout started but never completed) reads as `undefined`, a genuine
 *  "nothing to reconcile" rather than an error. */
async function findMostRecentSubscription(
  client: ReconcileSubscriptionsClient,
  companyId: string,
): Promise<ReconcileSubscriptionFacts | undefined> {
  const pages = await client.subscriptions.list({ externalCustomerId: companyId, limit: 10 });
  for await (const page of pages) {
    if (page.result.items.length > 0) return page.result.items[0];
  }
  return undefined;
}

/**
 * Re-checks Polar directly when `sub` looks stale (not `ACTIVE`, but already has a `polarCustomerId`)
 * and the per-company cache window has elapsed. Returns the (possibly updated) subscription row —
 * unchanged, and without ever touching the network, for a company that is already `ACTIVE`, has no
 * `polarCustomerId` yet, or was checked too recently. Never throws: a Polar outage here must not turn
 * `GET /api/billing/status` into a 500, the existing local row is simply returned as-is.
 */
export async function reconcileFromPolarIfStale(
  sub: CompanySubscription,
  client: ReconcileSubscriptionsClient = getPolarClient() as unknown as ReconcileSubscriptionsClient,
  now: number = Date.now(),
): Promise<CompanySubscription> {
  if (sub.status === 'ACTIVE') return sub;
  if (!sub.polarCustomerId) return sub;

  const lastCheckedAt = lastCheckedAtByCompanyId.get(sub.companyId);
  if (lastCheckedAt !== undefined && now - lastCheckedAt < RECONCILE_CACHE_MS) return sub;
  lastCheckedAtByCompanyId.set(sub.companyId, now);

  try {
    const latest = await findMostRecentSubscription(client, sub.companyId);
    if (!latest) return sub;

    await applySubscriptionWebhook({
      companyId: sub.companyId,
      polarSubscriptionId: latest.id,
      polarCustomerId: latest.customerId,
      status: latest.status,
      recurringInterval: latest.recurringInterval,
    });

    return await getOrCreateCompanySubscription(sub.companyId);
  } catch (error) {
    logger.warn('Polar status reconcile failed — the local row is unchanged, next request will retry', {
      category: 'billing',
      details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
    });
    return sub;
  }
}
