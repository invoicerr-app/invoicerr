/**
 * Applies a Polar subscription webhook payload to `CompanySubscription`. The subscription object's own
 * `status` is authoritative regardless of which event name fired, so there is no per-event branching.
 * Kept free of `@polar-sh/*` imports so specs need no ESM mocking.
 *
 * A pre-migration customer's `external_id` is a user id, so it resolves to no company. Its non-billable
 * facts are recovered via the stored `polarSubscriptionId` and recomputed the anchored way
 * `status-reconcile.ts` does, since such a delivery can arrive long after the fact.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  CompanySubscriptionInterval,
  CompanySubscriptionStatus,
} from '../../../prisma/generated/prisma/client';
import {
  getOrCreateCompanySubscription,
  recomputeStatusForVanishedSubscription,
} from './company-subscription.store';
import { invalidateCompanyCustomerFactsCache } from './legacy-customer';

/**
 * Collapses Polar's subscription status onto ACTIVE or PAST_DUE. Every non-active status, including a
 * payment failure, deliberately starts the same suspension countdown as an outright cancellation.
 */
export function mapPolarSubscriptionStatus(status: string): CompanySubscriptionStatus {
  return status === 'active' || status === 'trialing' ? 'ACTIVE' : 'PAST_DUE';
}

/** Maps to the two configured intervals; `day`/`week` map to `null`, meaning keep the stored interval. */
export function mapPolarRecurringInterval(interval: string): CompanySubscriptionInterval | null {
  if (interval === 'month') return 'MONTH';
  if (interval === 'year') return 'YEAR';
  return null;
}

export interface PolarSubscriptionWebhookFacts {
  companyId: string;
  polarSubscriptionId: string;
  polarCustomerId: string;
  status: string;
  recurringInterval: string;
  /** Seat quantity flows only from Polar into this app, never the reverse. `undefined` leaves the stored
   *  value alone rather than overwriting it. */
  seats?: number;
  /** End of the period already paid for. `undefined` leaves the stored value alone. */
  currentPeriodEnd?: Date;
  /** When this fact happened Polar-side; `undefined` skips the staleness check. */
  factAt?: Date;
}

/**
 * Fallback when `facts.companyId` matches no company: a legacy per-user customer's cancellation is
 * applied to the company whose stored row carries the same `polarSubscriptionId`.
 */
async function recoverLegacySubscriptionCancellation(facts: PolarSubscriptionWebhookFacts): Promise<void> {
  const legacyRow = await prisma.companySubscription.findFirst({
    where: { polarSubscriptionId: facts.polarSubscriptionId },
    select: { companyId: true, trialEndsAt: true, lastPolarFactAt: true },
  });

  if (!legacyRow) {
    // No `companyId`: `facts.companyId` resolved to no real company, so attributing the log to it
    // would be a fabricated scope.
    logger.info(
      'Polar webhook: no company for the resolved id, and no stored row matches this subscription ' +
        'either — deleted, or a foreign event. Ignored.',
      {
        category: 'billing',
        details: { companyId: facts.companyId, polarSubscriptionId: facts.polarSubscriptionId },
      },
    );
    return;
  }

  const mappedStatus = mapPolarSubscriptionStatus(facts.status);
  if (mappedStatus === 'ACTIVE') {
    // Never let a fact from a customer no longer authoritative for the company revive it.
    return;
  }

  if (
    facts.factAt &&
    legacyRow.lastPolarFactAt &&
    facts.factAt.getTime() < legacyRow.lastPolarFactAt.getTime()
  ) {
    logger.warn(
      'Ignored a stale legacy-customer Polar fact — a fresher one was already applied for this company',
      {
        category: 'billing',
        // The recovered company, not `facts.companyId` (which resolved to nothing).
        companyId: legacyRow.companyId,
        details: {
          companyId: legacyRow.companyId,
          factAt: facts.factAt,
          lastPolarFactAt: legacyRow.lastPolarFactAt,
        },
      },
    );
    return;
  }

  logger.warn(
    'Polar webhook: recovered a legacy per-user subscription cancellation/revocation by matching ' +
      'polarSubscriptionId — company row recomputed',
    {
      category: 'billing',
      companyId: legacyRow.companyId,
      details: {
        companyId: legacyRow.companyId,
        polarSubscriptionId: facts.polarSubscriptionId,
        status: facts.status,
      },
    },
  );

  const anchor = facts.factAt ?? legacyRow.lastPolarFactAt ?? new Date();
  await recomputeStatusForVanishedSubscription(legacyRow.companyId, legacyRow.trialEndsAt, anchor);
}

/**
 * Lazily creates the row so a first-seen company never throws. Drops a fact older than
 * `lastPolarFactAt` (a reconcile read can race a fresher webhook). An ACTIVE fact also clears the
 * block/zip/deletion clocks so a recovered company is not deleted on a stale `deletionDueAt`.
 */
export async function applySubscriptionWebhook(
  facts: PolarSubscriptionWebhookFacts,
  now: Date = new Date(),
): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: facts.companyId }, select: { id: true } });
  if (!company) {
    await recoverLegacySubscriptionCancellation(facts);
    return;
  }

  const sub = await getOrCreateCompanySubscription(facts.companyId);

  if (facts.factAt && sub.lastPolarFactAt && facts.factAt.getTime() < sub.lastPolarFactAt.getTime()) {
    logger.warn('Ignored a stale Polar fact — a fresher one was already applied for this company', {
      category: 'billing',
      companyId: facts.companyId,
      details: { companyId: facts.companyId, factAt: facts.factAt, lastPolarFactAt: sub.lastPolarFactAt },
    });
    return;
  }

  const mappedStatus = mapPolarSubscriptionStatus(facts.status);

  // A non-active fact (e.g. an abandoned checkout) must not cut a still-valid trial short, nor walk a
  // BLOCKED/ZIPPED company back to the writable PAST_DUE status, which would restart its grace window.
  const stillInsideOwnTrial = sub.status === 'TRIAL' && now.getTime() < sub.trialEndsAt.getTime();
  const alreadySuspended = sub.status === 'BLOCKED' || sub.status === 'ZIPPED';
  if (mappedStatus === 'PAST_DUE' && (stillInsideOwnTrial || alreadySuspended)) {
    // Deliberately a full no-op, not even `lastPolarFactAt`: webhooks are unordered, and advancing the
    // watermark here would make a still-pending, older `subscription.active` fact look stale forever.
    return;
  }
  const status = mappedStatus;
  const interval = mapPolarRecurringInterval(facts.recurringInterval);

  await prisma.companySubscription.update({
    where: { companyId: facts.companyId },
    data: {
      status,
      polarSubscriptionId: facts.polarSubscriptionId,
      polarCustomerId: facts.polarCustomerId,
      ...(interval ? { interval } : {}),
      ...(facts.seats !== undefined ? { seats: facts.seats } : {}),
      // Mirrored only from an ACTIVE fact: a `past_due` fact can carry the end of a period nobody has
      // paid for yet, and the rules reading this column grant access based on it.
      ...(status === 'ACTIVE' && facts.currentPeriodEnd !== undefined
        ? { currentPeriodEnd: facts.currentPeriodEnd }
        : {}),
      ...(facts.factAt ? { lastPolarFactAt: facts.factAt } : {}),
      ...(status === 'ACTIVE'
        ? { blockedAt: null, zipSentAt: null, deletionDueAt: null, seatPaymentFailedAt: null }
        : {}),
    },
  });

  // A real Polar customer now exists for this company: drop the cached `hasCompanyCustomer` answer.
  // This only fixes the local process; see `legacy-customer.ts` for multi-replica deployments.
  invalidateCompanyCustomerFactsCache(facts.companyId);
}

/** Narrow local shape shared by all six subscription events, already remapped from Polar's snake_case
 *  wire fields by `polar-webhook.controller.ts`. */
export interface SubscriptionWebhookPayload {
  data: {
    id: string;
    customerId: string;
    status: string;
    recurringInterval: string;
    seats?: number;
    /** Wire `current_period_end`, remapped to a camelCase `Date` by `polar-webhook.controller.ts`. */
    currentPeriodEnd?: Date;
    metadata: Record<string, string | number | boolean>;
    /** The customer's `external_id`, which equals the companyId for every customer this app creates. */
    customerExternalId?: string;
  };
}

/** `factAt` is the delivery's `webhook-timestamp`, used by `applySubscriptionWebhook`'s staleness check. */
export async function handleSubscriptionPayload(
  payload: SubscriptionWebhookPayload,
  factAt?: Date,
): Promise<void> {
  // Primary: the customer's `external_id` (= company.id). Fallback: `metadata.companyId` stamped at
  // checkout, in case Polar omits the nested `customer` object.
  const companyId = payload.data.customerExternalId || payload.data.metadata?.companyId;
  if (companyId === undefined || companyId === '') {
    // Never thrown: Polar retries a non-2xx response, and a foreign event has nothing to do here.
    return;
  }

  await applySubscriptionWebhook({
    companyId: String(companyId),
    polarSubscriptionId: payload.data.id,
    polarCustomerId: payload.data.customerId,
    status: payload.data.status,
    recurringInterval: payload.data.recurringInterval,
    seats: payload.data.seats,
    currentPeriodEnd: payload.data.currentPeriodEnd,
    factAt,
  });
}
