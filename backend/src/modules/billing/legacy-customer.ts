/**
 * Two related per-company Polar-customer facts `GET /api/billing/status` needs and cannot derive from
 * the LOCAL `CompanySubscription` row alone (option A, product decision 2026-09-16: one Polar customer
 * PER COMPANY, `external_id = company.id` — see `billing-customer.ts`'s own header):
 *
 *  - `hasCompanyCustomer` — does THIS company already have its OWN, company-scoped Polar customer?
 *    `billing.settings.tsx` uses this to decide whether "Manage subscription" can even be shown — a
 *    concrete 2026-09-16 dev-instance incident proved a company WITHOUT one still saw that button, and
 *    clicking it surfaced `portal-session.ts`'s own raw `PolarCustomerNotFoundError` message verbatim.
 *  - `legacySubscription` — does the STORED subscription still point at the pre-migration, per-USER
 *    Polar customer (`legacy-customer.ts` used to be this file's whole reason to exist, before
 *    `hasCompanyCustomer` joined it) — surfaced so the settings screen shows a plain re-subscribe
 *    notice instead of trying (there is no Polar API to migrate an existing subscription: checked
 *    directly against the SDK's own `Customers`/`Subscriptions` operation lists, 2026-09-16 — neither
 *    exposes a `merge`/`transfer`, and `Subscriptions.update` has no `customerId` field).
 *
 * Computed TOGETHER, from the SAME single `customers.getExternal({ externalId: companyId })` call,
 * deliberately: both questions turn on the exact same fact (does a company-scoped customer exist, and
 * if so, is it the one the subscription row actually points at), so splitting them into two Polar round
 * trips would double this endpoint's own Polar traffic for nothing. Detection reasoning:
 *
 *  - The call SUCCEEDS → `hasCompanyCustomer: true`. `legacySubscription` is then true only if the
 *    stored `polarCustomerId` is BOTH set and DIFFERENT from this company-scoped customer's own id —
 *    covers the case where a company-scoped customer already exists (pre-filled by
 *    `getOrCreatePolarCustomerForCompany`, or by `customer-provisioning.ts`'s own boot/sweep sync) but
 *    the currently-stored subscription still belongs to the OLD per-user one.
 *  - The call 404s → `hasCompanyCustomer: false`. `legacySubscription` is then true only if this row
 *    already has SOME `polarCustomerId` on file — nothing else could have written that id besides the
 *    pre-migration per-user flow, since option A never stores a customer id without first confirming
 *    (or creating) the company-scoped one.
 *  - Any OTHER failure (a Polar outage, a bad token) never throws: the codebase-wide convention this
 *    whole module family holds (`status-reconcile.ts`'s own header) is that a Polar outage must not turn
 *    `GET /api/billing/status` into a 500 — both facts default to the SAFER reading (no scary notice, no
 *    button hidden that would otherwise be shown) rather than propagating.
 *
 * Cached the same 5-minute-per-company way `status-reconcile.ts` already caches its own Polar calls —
 * this is a genuine extra network round-trip per company on every `GET /api/billing/status`, so it must
 * not turn a dashboard tab left open into a Polar API hot loop.
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

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. */
export interface CompanyCustomerFactsClient {
  customers: {
    getExternal(request: { externalId: string }): Promise<{ id: string }>;
  };
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

  let facts: CompanyCustomerFacts;
  try {
    const companyScopedCustomer = await client.customers.getExternal({ externalId: sub.companyId });
    facts = {
      hasCompanyCustomer: true,
      legacySubscription: sub.polarCustomerId !== null && companyScopedCustomer.id !== sub.polarCustomerId,
    };
  } catch (error) {
    if (isResourceNotFoundError(error)) {
      facts = { hasCompanyCustomer: false, legacySubscription: sub.polarCustomerId !== null };
    } else {
      logger.warn('Company Polar-customer facts check failed — defaulting to the safer reading', {
        category: 'billing',
        details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
      });
      facts = { hasCompanyCustomer: false, legacySubscription: false };
    }
  }

  lastCheckedAtByCompanyId.set(sub.companyId, now);
  lastFactsByCompanyId.set(sub.companyId, facts);
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
 * Whether `portal-session.ts#createLegacyCustomerPortalSession` has a real chance of opening — i.e.
 * whether a Polar customer is registered at all under `externalId = userId` (the CLICKING user, the old
 * per-user flow's own external id). Purely an existence check (no session is created here) so
 * `billing.settings.tsx` can decide link-vs-plain-text WITHOUT spending a real portal session on a
 * company that will never click it. Only ever called when `legacySubscription` is already true
 * (`billing.controller.ts`'s own `getStatus`), so this stays a rare extra Polar call, not a per-request
 * one. Never throws: a Polar outage here reads as "not available" (plain text), the safer default.
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
    await client.customers.getExternal({ externalId: userId });
    result = true;
  } catch (error) {
    if (!isResourceNotFoundError(error)) {
      logger.warn('Legacy Polar-customer existence check failed — defaulting to unavailable', {
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
