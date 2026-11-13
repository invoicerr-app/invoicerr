/**
 * Polar-side customer facts `GET /api/billing/status` needs beyond the local `CompanySubscription` row:
 *
 *  - `hasCompanyCustomer`: does the company-scoped Polar customer (`external_id = company.id`) exist.
 *  - `legacySubscription`: does the stored `polarCustomerId` point at an old per-user customer that still
 *    exists with a live subscription. Polar cannot migrate a subscription between customers, so the user
 *    is told to re-subscribe; it is checked live so it clears once that customer is deleted.
 *
 * Polar outages never throw (status must not 500) and default to the safer reading. Results are cached
 * per company, except a confirmed absence (404): the cache is per process while webhooks and checkouts
 * land on other replicas or the worker, and a stale `false` showed "Subscribe" again and caused double
 * billing. `polarCustomerId` cannot stand in for the live check because it may still hold a legacy id.
 */
import { logger } from '@/logger/logger.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { isResourceNotFoundError } from './billing-customer';
import { getPolarClient } from './polar-client';

const FACTS_CACHE_MS = 5 * 60 * 1000;

export interface CompanyCustomerFacts {
  hasCompanyCustomer: boolean;
  legacySubscription: boolean;
}

const lastCheckedAtByCompanyId = new Map<string, number>();
const lastFactsByCompanyId = new Map<string, CompanyCustomerFacts>();

export function resetCompanyCustomerFactsCacheForTests(): void {
  lastCheckedAtByCompanyId.clear();
  lastFactsByCompanyId.clear();
}

/**
 * Call wherever `hasCompanyCustomer` can flip to true. Only helps within one process; not caching
 * negatives is what keeps other replicas correct.
 */
export function invalidateCompanyCustomerFactsCache(companyId: string): void {
  lastCheckedAtByCompanyId.delete(companyId);
  lastFactsByCompanyId.delete(companyId);
}

/** Narrow, mockable subset of the Polar SDK client. `getState` 404s when the customer is gone and lists
 *  its live subscriptions in one call. */
export interface CompanyCustomerFactsClient {
  customers: {
    getExternal(externalId: string): Promise<{ id: string }>;
    getState(id: string): Promise<{ active_subscriptions: unknown[] }>;
  };
}

/** `customerId` is Polar's internal id, not an external id. A 404 (customer deleted) reads as no. */
async function hasActiveSubscriptionOnLegacyCustomer(
  companyId: string,
  customerId: string,
  client: CompanyCustomerFactsClient,
): Promise<boolean> {
  try {
    const state = await client.customers.getState(customerId);
    return state.active_subscriptions.length > 0;
  } catch (error) {
    if (!isResourceNotFoundError(error)) {
      logger.warn('Legacy Polar-customer subscription check failed, defaulting to not legacy', {
        category: 'billing',
        companyId,
        details: { companyId, customerId, error: error instanceof Error ? error.message : String(error) },
      });
    }
    return false;
  }
}

export async function getCompanyCustomerFacts(
  sub: CompanySubscription,
  client: CompanyCustomerFactsClient = getPolarClient() as unknown as CompanyCustomerFactsClient,
  now: number = Date.now(),
): Promise<CompanyCustomerFacts> {
  const lastCheckedAt = lastCheckedAtByCompanyId.get(sub.companyId);
  if (lastCheckedAt !== undefined && now - lastCheckedAt < FACTS_CACHE_MS) {
    return (
      lastFactsByCompanyId.get(sub.companyId) ?? { hasCompanyCustomer: false, legacySubscription: false }
    );
  }

  let hasCompanyCustomer = false;
  let companyScopedCustomerId: string | null = null;
  try {
    const companyScopedCustomer = await client.customers.getExternal(sub.companyId);
    hasCompanyCustomer = true;
    companyScopedCustomerId = companyScopedCustomer.id;
  } catch (error) {
    if (!isResourceNotFoundError(error)) {
      logger.warn('Company Polar-customer facts check failed, defaulting to the safer reading', {
        category: 'billing',
        companyId: sub.companyId,
        details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
      });
      const facts: CompanyCustomerFacts = { hasCompanyCustomer: false, legacySubscription: false };
      lastCheckedAtByCompanyId.set(sub.companyId, now);
      lastFactsByCompanyId.set(sub.companyId, facts);
      return facts;
    }
  }

  const legacyCandidateId =
    sub.polarCustomerId !== null && sub.polarCustomerId !== companyScopedCustomerId
      ? sub.polarCustomerId
      : null;

  const legacySubscription = legacyCandidateId
    ? await hasActiveSubscriptionOnLegacyCustomer(sub.companyId, legacyCandidateId, client)
    : false;

  const facts: CompanyCustomerFacts = { hasCompanyCustomer, legacySubscription };
  // Never cache a confirmed "no": a stale false caused double billing across replicas (see header).
  if (hasCompanyCustomer) {
    lastCheckedAtByCompanyId.set(sub.companyId, now);
    lastFactsByCompanyId.set(sub.companyId, facts);
  }
  return facts;
}

const LEGACY_PORTAL_CACHE_MS = 5 * 60 * 1000;
const lastLegacyPortalCheckedAtByUserId = new Map<string, number>();
const lastLegacyPortalResultByUserId = new Map<string, boolean>();

export function resetLegacyPortalAvailabilityCacheForTests(): void {
  lastLegacyPortalCheckedAtByUserId.clear();
  lastLegacyPortalResultByUserId.clear();
}

/**
 * Whether a legacy per-user Polar customer exists for `userId`, so the settings screen can show the
 * legacy portal link without opening a session. Never throws; an outage reads as unavailable.
 */
export async function hasLegacyPolarCustomer(
  userId: string,
  client: CompanyCustomerFactsClient = getPolarClient() as unknown as CompanyCustomerFactsClient,
  now: number = Date.now(),
): Promise<boolean> {
  const lastCheckedAt = lastLegacyPortalCheckedAtByUserId.get(userId);
  if (lastCheckedAt !== undefined && now - lastCheckedAt < LEGACY_PORTAL_CACHE_MS) {
    return lastLegacyPortalResultByUserId.get(userId) ?? false;
  }

  let result: boolean;
  try {
    await client.customers.getExternal(userId);
    result = true;
  } catch (error) {
    if (!isResourceNotFoundError(error)) {
      logger.warn('Legacy Polar-customer existence check failed, defaulting to unavailable', {
        category: 'billing',
        details: { userId, error: error instanceof Error ? error.message : String(error) },
      });
    }
    result = false;
  }

  lastLegacyPortalCheckedAtByUserId.set(userId, now);
  lastLegacyPortalResultByUserId.set(userId, result);
  return result;
}
