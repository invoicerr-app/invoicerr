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
 * `polarCustomerId` to reconcile FROM (a company that never reached Polar at all has nothing to check).
 * `reconcileFromPolar` reads the customer's subscriptions straight back from Polar and, if one is
 * billable, applies it through the exact same `applySubscriptionWebhook` a real webhook would have used
 * — so a repaired row is indistinguishable from one the webhook had updated correctly. Cached per
 * company for `RECONCILE_CACHE_MS` so a dashboard tab left open polling `/billing/status` cannot turn
 * into a Polar API hot loop.
 *
 * ## An `ACTIVE` row is no longer trusted blindly (2026-09-16)
 *
 * Originally this whole module short-circuited on `sub.status === 'ACTIVE'` — a genuine no-op forever
 * once the row was "genuinely" active, on the assumption only a webhook could ever move it again. A
 * concrete 2026-09-16 dev-instance incident broke that assumption: the OWNER deleted, by hand in
 * Polar's own dashboard, the pre-migration per-user customer this company's row had last gone `ACTIVE`
 * from. The company's OWN, company-scoped customer (option A, `billing-customer.ts`'s own header,
 * created lazily or by `customer-provisioning.ts`'s boot sweep) had no subscription of its own at all —
 * and because the deletion's own webhook resolved to a companyId this app could not match (a USER id,
 * not a company id — `webhook-handlers.ts`'s own header on the matching fix there), nothing ever
 * corrected the row. `GET /api/billing/status` kept answering `ACTIVE` indefinitely.
 *
 * `findMostRecentSubscription` below is ALREADY filtered by `externalCustomerId: companyId` (the
 * company's own customer, never the stored `polarCustomerId` — see that function's own header), so it
 * was already the right read to catch this; it simply used to never RUN for an `ACTIVE` row. Now it
 * always runs (cached, same as before) regardless of the stored status, and an `ACTIVE` row whose own
 * customer reports NO subscription at all is recomputed via `lifecycle.ts#computeRecoveredStatus`
 * (`company-subscription.store.ts#recomputeStatusForVanishedSubscription`) instead of being left as-is
 * — never a persistent cost once genuinely resolved either way (an `ACTIVE` company with a real
 * subscription, or a company correctly downgraded to `PAST_DUE`/`BLOCKED`, both settle into a steady
 * state this module keeps confirming, cheaply, once per cache window).
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

/** Module-level, process-local — same "best-effort, never a source of truth on its own" spirit as
 *  `polar-client.ts`'s own cached client; a multi-instance deployment simply re-checks slightly more
 *  often than one replica alone would, never incorrectly (there is no shared state to get wrong). */
const lastCheckedAtByCompanyId = new Map<string, number>();

export function resetStatusReconcileCacheForTests(): void {
  lastCheckedAtByCompanyId.clear();
}

/** The subset of a Polar `Subscription` this module actually reads — the same fields
 *  `webhook-handlers.ts`'s own `PolarSubscriptionWebhookFacts` carries, before mapping, plus
 *  `modifiedAt` (`@polar-sh/sdk`'s `Subscription.modifiedAt`, confirmed by reading
 *  `node_modules/@polar-sh/sdk/dist/commonjs/models/components/subscription.d.ts` directly) — this
 *  read's own fact timestamp, threaded through
 *  as `factAt` so `applySubscriptionWebhook`'s staleness check can drop it if a webhook already
 *  applied something NEWER (see that function's own header). */
interface ReconcileSubscriptionFacts {
  id: string;
  customerId: string;
  status: string;
  recurringInterval: string;
  metadata: Record<string, string | number | boolean>;
  modifiedAt?: string | Date | null;
  createdAt?: string | Date | null;
  /** `@polar-sh/sdk`'s own `Subscription.currentPeriodEnd` (confirmed by the same
   *  `subscription.d.ts` read `webhook-handlers.ts`'s own header cites) — threaded through to
   *  `applySubscriptionWebhook` below the same way a real webhook's `current_period_end` is, so a
   *  repaired row is indistinguishable from one a webhook had updated correctly (this module's own
   *  header). */
  currentPeriodEnd?: Date | null;
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
 * Re-checks Polar directly against `sub`'s own company-scoped customer, at most once per
 * `RECONCILE_CACHE_MS` per company. Returns the (possibly updated) subscription row — unchanged, and
 * without ever touching the network, for a company with no `polarCustomerId` yet or checked too
 * recently. Never throws: a Polar outage here must not turn `GET /api/billing/status` into a 500, the
 * existing local row is simply returned as-is.
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
      const factTimestamp = latest.modifiedAt ?? latest.createdAt;

      await applySubscriptionWebhook({
        companyId: sub.companyId,
        polarSubscriptionId: latest.id,
        polarCustomerId: latest.customerId,
        status: latest.status,
        recurringInterval: latest.recurringInterval,
        currentPeriodEnd: latest.currentPeriodEnd ?? undefined,
        // `undefined` (never a genuinely unparseable Date) when Polar reports neither — see
        // `applySubscriptionWebhook`'s own header: an absent `factAt` applies unconditionally, the
        // safe default when this read has no timestamp of its own to compare against a webhook's.
        factAt: factTimestamp ? new Date(factTimestamp) : undefined,
      });

      return await getOrCreateCompanySubscription(sub.companyId);
    }

    // No subscription at all for the company's OWN customer. Normal — and a genuine no-op — for
    // TRIAL/PAST_DUE/BLOCKED/ZIPPED (a company that never subscribed, or fell behind for real, simply
    // has none; the ordinary sweep already owns advancing those). Only an `ACTIVE` row is actually
    // WRONG here — see this file's own header on the 2026-09-16 incident this repairs.
    if (sub.status !== 'ACTIVE') return sub;

    logger.warn(
      'Polar status reconcile: company was ACTIVE but its own company-scoped customer has no ' +
        'subscription at all — recomputing (likely a stale row from a deleted pre-migration customer)',
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
    logger.warn('Polar status reconcile failed — the local row is unchanged, next request will retry', {
      category: 'billing',
      companyId: sub.companyId,
      details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
    });
    return sub;
  }
}
