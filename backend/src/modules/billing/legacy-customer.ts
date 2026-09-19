/**
 * Two related per-company Polar-customer facts `GET /api/billing/status` needs and cannot derive from
 * the LOCAL `CompanySubscription` row alone (option A, product decision 2026-09-16: one Polar customer
 * PER COMPANY, `external_id = company.id` — see `billing-customer.ts`'s own header):
 *
 *  - `hasCompanyCustomer` — does THIS company already have its OWN, company-scoped Polar customer?
 *    `billing.settings.tsx` uses this to decide whether "Manage subscription" can even be shown — a
 *    concrete 2026-09-16 dev-instance incident proved a company WITHOUT one still saw that button, and
 *    clicking it surfaced `portal-session.ts`'s own raw `PolarCustomerNotFoundError` message verbatim.
 *  - `legacySubscription` — does the STORED subscription still point at a pre-migration, per-USER Polar
 *    customer that ITSELF still exists and still carries a live (active/trialing) subscription —
 *    surfaced so the settings screen shows a plain re-subscribe notice instead of trying (there is no
 *    Polar API to migrate an existing subscription: checked directly against the SDK's own
 *    `Customers`/`Subscriptions` operation lists, 2026-09-16 — neither exposes a `merge`/`transfer`,
 *    and `Subscriptions.update` has no `customerId` field).
 *
 * ## `legacySubscription` is VERIFIED directly against the old customer, not merely inferred (2026-09-16)
 *
 * Originally this only compared the STORED `polarCustomerId` against the company-scoped customer's own
 * id — "differs (or 404s with something on file) ⇒ legacy" — never actually checking whether that OLD
 * customer was still real. A concrete dev-instance incident broke that: the OWNER deleted the old
 * per-user customer by hand in Polar's own dashboard (its subscription went `canceled`, the customer
 * itself now 404s), yet the inference alone had no way to notice — it would have kept reporting
 * `legacySubscription: true` (a "re-subscribe" notice pointing at a customer that no longer exists)
 * forever. Now the OLD customer identified by `sub.polarCustomerId` (when it differs from the
 * company-scoped one) is checked DIRECTLY via `customers.getState` — a single call that both confirms
 * existence (404 if gone) and reports its own `activeSubscriptions` in one round trip, so
 * `legacySubscription` is true only while there is something real left to warn about.
 *
 * `hasCompanyCustomer` is unaffected by this and still comes from the SAME single
 * `customers.getExternal({ externalId: companyId })` call it always has (does a company-scoped customer
 * exist at all) — the two questions no longer share one Polar round trip, but `legacySubscription`'s own
 * extra `getState` call only ever fires when a legacy candidate id is actually on file, the rare path,
 * so a company that has never touched a legacy customer costs nothing extra.
 *
 *  - The `getExternal` call SUCCEEDS → `hasCompanyCustomer: true`, and the legacy candidate is
 *    `sub.polarCustomerId` when it is set and DIFFERENT from this company-scoped customer's own id.
 *  - The call 404s → `hasCompanyCustomer: false`, and the legacy candidate is simply `sub.polarCustomerId`
 *    when set — nothing else could have written that id besides the pre-migration per-user flow, since
 *    option A never stores a customer id without first confirming (or creating) the company-scoped one.
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
 *  billing file narrows its own client shape to. `getState` — "Get Customer State by ID" — is the ONE
 *  call `hasActiveSubscriptionOnLegacyCustomer` below needs: it 404s the same way `getExternal` does
 *  when the customer is gone, and its own `activeSubscriptions` array is Polar's own answer to "does
 *  this customer still have anything live", no separate `subscriptions.list` round trip required. */
export interface CompanyCustomerFactsClient {
  customers: {
    getExternal(request: { externalId: string }): Promise<{ id: string }>;
    getState(request: { id: string }): Promise<{ activeSubscriptions: unknown[] }>;
  };
}

/** Whether the OLD per-user Polar customer at `customerId` (Polar's own internal id, NOT an external
 *  id) still exists AND still carries at least one active/trialing subscription — see this file's own
 *  header (2026-09-16) on why `legacySubscription` must go FALSE the moment either stops being true,
 *  rather than staying true forever purely because the row's `polarCustomerId` happens to differ from
 *  the company-scoped one. A 404 (the customer itself was deleted — the exact reported incident) reads
 *  as "no", the same safe default every other check in this module already applies to an outage. */
async function hasActiveSubscriptionOnLegacyCustomer(
  companyId: string,
  customerId: string,
  client: CompanyCustomerFactsClient,
): Promise<boolean> {
  try {
    const state = await client.customers.getState({ id: customerId });
    return state.activeSubscriptions.length > 0;
  } catch (error) {
    if (!isResourceNotFoundError(error)) {
      logger.warn('Legacy Polar-customer subscription check failed — defaulting to not legacy', {
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
    const companyScopedCustomer = await client.customers.getExternal({ externalId: sub.companyId });
    hasCompanyCustomer = true;
    companyScopedCustomerId = companyScopedCustomer.id;
  } catch (error) {
    if (!isResourceNotFoundError(error)) {
      logger.warn('Company Polar-customer facts check failed — defaulting to the safer reading', {
        category: 'billing',
        companyId: sub.companyId,
        details: { companyId: sub.companyId, error: error instanceof Error ? error.message : String(error) },
      });
      const facts: CompanyCustomerFacts = { hasCompanyCustomer: false, legacySubscription: false };
      lastCheckedAtByCompanyId.set(sub.companyId, now);
      lastFactsByCompanyId.set(sub.companyId, facts);
      return facts;
    }
    // 404 — a company with no company-scoped customer of its own (yet). `hasCompanyCustomer` stays
    // `false`; the legacy check below still runs against `sub.polarCustomerId`, if any.
  }

  // The candidate legacy customer — the STORED id, only when it is not the SAME id as the company's
  // own (see this file's own header on why this, rather than the old "just infer it" heuristic, is now
  // the correct signal).
  const legacyCandidateId =
    sub.polarCustomerId !== null && sub.polarCustomerId !== companyScopedCustomerId
      ? sub.polarCustomerId
      : null;

  const legacySubscription = legacyCandidateId
    ? await hasActiveSubscriptionOnLegacyCustomer(sub.companyId, legacyCandidateId, client)
    : false;

  const facts: CompanyCustomerFacts = { hasCompanyCustomer, legacySubscription };
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
