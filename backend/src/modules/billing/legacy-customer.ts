/**
 * Detects a `CompanySubscription` whose `polarCustomerId` still points at the OLD, per-USER Polar
 * customer from before the 2026-09-16 "one Polar customer per company" migration (option A — see
 * `billing-customer.ts`'s own header for the new flow). Surfaced by `GET /api/billing/status` as
 * `legacySubscription: true` so `billing.settings.tsx` can show a plain re-subscribe notice.
 *
 * Polar has no API to move an existing subscription onto a different customer (checked directly
 * against the SDK's own `Customers`/`Subscriptions` operation lists, 2026-09-16 — neither exposes a
 * `merge`/`transfer`, and `Subscriptions.update` has no `customerId` field), so the only real fix for
 * an affected company is a fresh checkout under its OWN company-scoped customer — this module only
 * detects the situation, it never tries to repair it automatically.
 *
 * Detection: does THIS company already have its own external-id-keyed Polar customer, and if so, is
 * it the SAME customer the stored subscription actually belongs to? A company with no polarCustomerId
 * at all has nothing to be legacy about (never subscribed, either flow). One WITH a polarCustomerId
 * but no company-scoped customer registered yet (`getExternal` 404s) can only be pointing at the
 * pre-migration per-user customer — nothing else could have written that id. One whose company-scoped
 * customer's own id DIFFERS from the stored one is the same situation with the company-scoped customer
 * already having been created some other way (e.g. a pre-fill via `getOrCreatePolarCustomerForCompany`
 * that has not checked out yet). Only when the two ids MATCH is this genuinely the new flow.
 *
 * Cached the same 5-minute-per-company way `status-reconcile.ts` already caches its own Polar calls —
 * this is a genuine extra network round-trip per ACTIVE/PAST_DUE company, so it must not turn a
 * dashboard tab left open into a Polar API hot loop. Never throws: the codebase-wide convention this
 * whole module family holds (`status-reconcile.ts`'s own header) is that a Polar outage must not turn
 * `GET /api/billing/status` into a 500 — a transient failure here reads as "not legacy" (the SAFER
 * default: no scary notice shown on a hiccup) rather than propagating.
 */
import { logger } from '@/logger/logger.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { isResourceNotFoundError } from './billing-customer';
import { getPolarClient } from './polar-client';

const LEGACY_CHECK_CACHE_MS = 5 * 60 * 1000;

const lastCheckedAtByCompanyId = new Map<string, number>();
const lastResultByCompanyId = new Map<string, boolean>();

export function resetLegacySubscriptionCacheForTests(): void {
  lastCheckedAtByCompanyId.clear();
  lastResultByCompanyId.clear();
}

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. */
export interface LegacyCustomerCheckClient {
  customers: {
    getExternal(request: { externalId: string }): Promise<{ id: string }>;
  };
}

export async function isLegacyUserLevelSubscription(
  sub: CompanySubscription,
  client: LegacyCustomerCheckClient = getPolarClient() as unknown as LegacyCustomerCheckClient,
  now: number = Date.now(),
): Promise<boolean> {
  if (!sub.polarCustomerId) return false;

  const lastCheckedAt = lastCheckedAtByCompanyId.get(sub.companyId);
  if (lastCheckedAt !== undefined && now - lastCheckedAt < LEGACY_CHECK_CACHE_MS) {
    return lastResultByCompanyId.get(sub.companyId) ?? false;
  }

  let result: boolean;
  try {
    const companyScopedCustomer = await client.customers.getExternal({ externalId: sub.companyId });
    result = companyScopedCustomer.id !== sub.polarCustomerId;
  } catch (error) {
    if (isResourceNotFoundError(error)) {
      // No company-scoped customer exists AT ALL, yet this row already has a polarCustomerId — that
      // customer can only be the pre-migration per-USER one (see this file's own header).
      result = true;
    } else {
      logger.warn('Legacy-subscription check failed — assuming not legacy', {
        category: 'billing',
        details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
      });
      result = false;
    }
  }

  lastCheckedAtByCompanyId.set(sub.companyId, now);
  lastResultByCompanyId.set(sub.companyId, result);
  return result;
}
