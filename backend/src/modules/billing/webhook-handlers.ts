/**
 * Turns one Polar subscription webhook payload into a `CompanySubscription` write — reused, verbatim,
 * for every subscription event `polar-webhook.controller.ts` dispatches (`subscription.created`,
 * `.active`, `.updated`, `.canceled` — still billable until the period ends —, `.uncanceled`, or
 * `.revoked` — actually terminated): the SUBSCRIPTION OBJECT's own `status`/`recurringInterval` fields
 * are authoritative regardless of which specific event name fired, so one function suffices; there is
 * no per-event-name branching to get right.
 *
 * Split out from the wiring layer specifically so it is testable WITHOUT constructing a real SDK/HTTP
 * harness (which would need a live `Polar` client or a running Nest app) — a spec calls this directly
 * with a plain object, the same "pure-ish core, thin wiring shell" split this whole directory holds.
 * `handleSubscriptionPayload` below used to live in `polar-plugin.ts`, called from the six
 * `onSubscription*` options of `@polar-sh/better-auth`'s own `webhooks()` sub-plugin — that plugin
 * relied on `@polar-sh/sdk`'s `validateEvent` for signature verification, which turned out to derive
 * the WRONG HMAC key for a real Polar delivery (see `polar-webhook.controller.ts`'s own header for the
 * full story, established 2026-09-15). It moved here once `polar-webhook.controller.ts` — this app's
 * own receiver, verifying the signature itself — became its only caller: this file has zero
 * `@polar-sh/*` import, so nothing here needs that package's ESM-only transitive dependency mocked
 * away under Jest the way `polar-plugin.spec.ts` still has to for `buildPolarAuthPlugins`.
 *
 * ## A company that no longer exists (or never did)
 *
 * Two situations resolve a `companyId` that this app cannot use: a webhook for a customer whose
 * company was since deleted (the DB's own `ON DELETE CASCADE` already took the `CompanySubscription`
 * row with it — `deletion.ts`'s own header), and a webhook for a customer created BEFORE the
 * 2026-09-16 per-company migration, whose `external_id` is a USER id, not a company id at all
 * (`legacy-customer.ts`'s own header — option A only ever mints customers with `external_id =
 * company.id`, but an old customer can still fire real webhooks). Both read identically from here:
 * `prisma.company` has no row for the resolved id. Rather than let `getOrCreateCompanySubscription`
 * attempt an `upsert` that would fail the request outright on the `CompanySubscription.companyId`
 * foreign key (a genuine 500 — Polar retries a non-2xx delivery forever), this is checked FIRST and
 * treated as "nothing for this app to do", exactly like an unresolvable `companyId` already was.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  CompanySubscriptionInterval,
  CompanySubscriptionStatus,
} from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription } from './company-subscription.store';

/**
 * Polar's own `SubscriptionStatus` values (`@polar-sh/sdk`'s `models/components/subscriptionstatus`)
 * collapsed onto this product's two "is this company currently allowed to send" buckets. `active` and
 * `trialing` (a Polar-side trial — this product never configures one, but the SDK's status enum
 * allows it) both read as genuinely billable; everything else — `past_due`, `unpaid`, `canceled`,
 * `incomplete`, `incomplete_expired`, `paused` — reads as PAST_DUE, which is deliberately the SAME
 * bucket `lifecycle.ts` folds straight into `blocked` on the very next sweep tick with no window of
 * its own (that file's own header): there is no legitimate reason to treat "payment failed" any
 * differently from "the subscription was outright canceled" for how fast the 14-day countdown starts.
 */
export function mapPolarSubscriptionStatus(status: string): CompanySubscriptionStatus {
  return status === 'active' || status === 'trialing' ? 'ACTIVE' : 'PAST_DUE';
}

/** Polar's `RecurringInterval` down to the two intervals this product actually configures
 *  (`POLAR_PRODUCT_ID_MONTHLY`/`POLAR_PRODUCT_ID_YEARLY`) — `day`/`week` (which the SDK's own type
 *  allows for OTHER Polar use cases) map to `null`, meaning "leave whatever interval was already
 *  stored alone" rather than write a value this product has no configured product for. */
export function mapPolarRecurringInterval(interval: string): CompanySubscriptionInterval | null {
  if (interval === 'month') return 'MONTH';
  if (interval === 'year') return 'YEAR';
  return null;
}

export interface PolarSubscriptionWebhookFacts {
  companyId: string;
  polarSubscriptionId: string;
  polarCustomerId: string;
  /** Polar's raw `Subscription.status` string, mapped by `mapPolarSubscriptionStatus` above. */
  status: string;
  /** Polar's raw `Subscription.recurringInterval` string, mapped by `mapPolarRecurringInterval` above. */
  recurringInterval: string;
  /** WHEN this fact actually happened, Polar-side — the delivering webhook's own `webhook-timestamp`
   *  header (`polar-webhook.controller.ts`) or, for a `status-reconcile.ts` repair read, the
   *  reconciled subscription's own `modifiedAt`. `undefined` applies UNCONDITIONALLY (the historical
   *  behavior, and what every hand-built fact set in this codebase's own specs still gets) — only a
   *  caller that actually HAS a timestamp opts into the staleness check below. */
  factAt?: Date;
}

/**
 * Applies one subscription fact set. Lazily creates the row first (`getOrCreateCompanySubscription`)
 * — a checkout completing for a company this process never saw before (a fresh deploy, a company that
 * jumped straight to checkout from a stale link) must still land somewhere real, never throw on a
 * missing row.
 *
 * A company that no longer exists at all (deleted, or never real — see this file's own header) is a
 * silent no-op, logged: never an unhandled DB foreign-key failure that would surface as a 500 to
 * Polar, which would then retry the same delivery forever.
 *
 * A STALE fact — `factAt` older than the last one already applied (`lastPolarFactAt`) — is dropped the
 * same way: `status-reconcile.ts`'s own live Polar read can, rarely, race a webhook that already
 * landed a NEWER fact (Polar's own read replica lagging its own webhook delivery); applying the older
 * read would incorrectly walk a company backward (e.g. re-declaring PAST_DUE a company a fresher
 * webhook already reported ACTIVE again). `factAt` itself is always persisted when supplied, whichever
 * branch runs, so the NEXT comparison is always against the most recent timestamp actually seen.
 *
 * When the mapped status is `ACTIVE`, this ALSO clears `blockedAt`/`zipSentAt`/`deletionDueAt`/
 * `seatPaymentFailedAt` — critical for a company that recovers from `PAST_DUE`/`BLOCKED`/`ZIPPED` by
 * paying again: without this reset, a `deletionDueAt` stamped while the company was struggling to pay
 * would still be ticking down in the background, and the NEXT lifecycle sweep tick would delete a
 * now-current-paying customer's data purely because a timestamp from before they fixed their card was
 * never cleared. `seatPaymentFailedAt` (`seat-sync.ts`'s own header) is the same idea for the
 * seat-specific "why is this company PAST_DUE" reason `billing-status-view.ts` shows.
 */
export async function applySubscriptionWebhook(facts: PolarSubscriptionWebhookFacts): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: facts.companyId }, select: { id: true } });
  if (!company) {
    logger.info(
      'Polar webhook: no company for the resolved id — deleted, or a pre-migration per-user customer. Ignored.',
      { category: 'billing', details: { companyId: facts.companyId } },
    );
    return;
  }

  const sub = await getOrCreateCompanySubscription(facts.companyId);

  if (facts.factAt && sub.lastPolarFactAt && facts.factAt.getTime() < sub.lastPolarFactAt.getTime()) {
    logger.warn('Ignored a stale Polar fact — a fresher one was already applied for this company', {
      category: 'billing',
      details: { companyId: facts.companyId, factAt: facts.factAt, lastPolarFactAt: sub.lastPolarFactAt },
    });
    return;
  }

  const status = mapPolarSubscriptionStatus(facts.status);
  const interval = mapPolarRecurringInterval(facts.recurringInterval);

  await prisma.companySubscription.update({
    where: { companyId: facts.companyId },
    data: {
      status,
      polarSubscriptionId: facts.polarSubscriptionId,
      polarCustomerId: facts.polarCustomerId,
      ...(interval ? { interval } : {}),
      ...(facts.factAt ? { lastPolarFactAt: facts.factAt } : {}),
      ...(status === 'ACTIVE'
        ? { blockedAt: null, zipSentAt: null, deletionDueAt: null, seatPaymentFailedAt: null }
        : {}),
    },
  });
}

/** Structurally typed from whatever a Polar subscription webhook's own `data` carries — every one of
 *  the six handled event types carries `{ data: Subscription }` with these fields in common, so one
 *  narrow local shape (just the fields `applySubscriptionWebhook` actually reads) covers all six
 *  without importing the SDK's full `Subscription` model. Already CAMELCASE
 *  (`customerId`/`recurringInterval`/`customerExternalId`) — `polar-webhook.controller.ts` is the one
 *  responsible for remapping Polar's snake_case WIRE fields (`customer_id`/`recurring_interval`/
 *  `customer.external_id`) into this shape before calling `handleSubscriptionPayload`; see that file's
 *  own header for why. */
export interface SubscriptionWebhookPayload {
  data: {
    id: string;
    customerId: string;
    status: string;
    recurringInterval: string;
    metadata: Record<string, string | number | boolean>;
    /** The subscription's own customer's `external_id` — option A (product decision 2026-09-16):
     *  `external_id = company.id` for every Polar customer this app creates (`billing-customer.ts`'s
     *  own header), so this IS the companyId whenever Polar includes it. Present on a real webhook's
     *  WIRE payload (confirmed live in sandbox, 2026-09-16, for both `subscription.*` and
     *  `order.*` events) — `undefined` only for a hand-built payload (a spec, or a future event type
     *  that genuinely omits it), never for a real delivery. */
    customerExternalId?: string;
  };
}

/**
 * `factAt` — the delivering webhook's own `webhook-timestamp` (`polar-webhook.controller.ts`, Standard
 * Webhooks' own delivery timestamp header) — threaded straight through to `applySubscriptionWebhook`'s
 * staleness check (see that function's own header). Optional so every hand-built payload in this
 * file's own spec keeps applying unconditionally, exactly as before.
 */
export async function handleSubscriptionPayload(
  payload: SubscriptionWebhookPayload,
  factAt?: Date,
): Promise<void> {
  // PRIMARY: the checkout's own customer, `external_id = company.id` under option A. FALLBACK:
  // `metadata.companyId` (stamped at checkout time, `checkout-session.ts`) — covers the rare case
  // Polar's own payload omits the nested `customer` object (never observed live, but the metadata
  // fallback costs nothing to keep). Never a `referenceId` metadata key any more — that was
  // `@polar-sh/better-auth`'s own checkout body param, gone along with the rest of `polar-plugin.ts`.
  const companyId = payload.data.customerExternalId || payload.data.metadata?.companyId;
  if (companyId === undefined || companyId === '') {
    // No companyId to resolve to. Never thrown: a malformed/foreign event must not fail the whole
    // webhook delivery (Polar retries a non-2xx response), it simply has nothing for this app to do.
    return;
  }

  await applySubscriptionWebhook({
    companyId: String(companyId),
    polarSubscriptionId: payload.data.id,
    polarCustomerId: payload.data.customerId,
    status: payload.data.status,
    recurringInterval: payload.data.recurringInterval,
    factAt,
  });
}
