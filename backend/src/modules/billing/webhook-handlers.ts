/**
 * Turns one Polar subscription webhook payload into a `CompanySubscription` write — reused, verbatim,
 * across every `onSubscription*` handler `polar-plugin.ts` registers with the `webhooks()` plugin:
 * the SUBSCRIPTION OBJECT's own `status`/`recurringInterval` fields are authoritative regardless of
 * which specific event name fired (`subscription.created`, `.active`, `.updated`, `.canceled` —
 * still billable until the period ends — or `.revoked` — actually terminated), so one function
 * suffices; there is no per-event-name branching to get right.
 *
 * Split out from `polar-plugin.ts` specifically so it is testable WITHOUT constructing the real
 * better-auth polar plugin (which needs a live `Polar` SDK client) — a spec calls this directly with
 * a plain object, the same "pure-ish core, thin wiring shell" split this whole directory holds.
 */
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
}

/**
 * Applies one subscription fact set. Lazily creates the row first (`getOrCreateCompanySubscription`)
 * — a checkout completing for a company this process never saw before (a fresh deploy, a company that
 * jumped straight to checkout from a stale link) must still land somewhere real, never throw on a
 * missing row.
 *
 * When the mapped status is `ACTIVE`, this ALSO clears `blockedAt`/`zipSentAt`/`deletionDueAt` —
 * critical for a company that recovers from `PAST_DUE`/`BLOCKED`/`ZIPPED` by paying again: without
 * this reset, a `deletionDueAt` stamped while the company was struggling to pay would still be
 * ticking down in the background, and the NEXT lifecycle sweep tick would delete a now-current-paying
 * customer's data purely because a timestamp from before they fixed their card was never cleared.
 */
export async function applySubscriptionWebhook(facts: PolarSubscriptionWebhookFacts): Promise<void> {
  await getOrCreateCompanySubscription(facts.companyId);

  const status = mapPolarSubscriptionStatus(facts.status);
  const interval = mapPolarRecurringInterval(facts.recurringInterval);

  await prisma.companySubscription.update({
    where: { companyId: facts.companyId },
    data: {
      status,
      polarSubscriptionId: facts.polarSubscriptionId,
      polarCustomerId: facts.polarCustomerId,
      ...(interval ? { interval } : {}),
      ...(status === 'ACTIVE' ? { blockedAt: null, zipSentAt: null, deletionDueAt: null } : {}),
    },
  });
}
