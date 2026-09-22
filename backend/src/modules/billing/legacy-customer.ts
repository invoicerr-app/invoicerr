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
 *
 * ## Stale `hasCompanyCustomer: false` caused double billing (2026-09-21)
 *
 * Observed live: a company subscribed successfully (`CompanySubscription` row `ACTIVE`,
 * `polarCustomerId`/`polarSubscriptionId` both set), yet `billing.settings.tsx` kept showing "Subscribe
 * yearly"/"Subscribe monthly" for up to five minutes — `canSubscribe` there is `status !== "ACTIVE" ||
 * !hasCompanyCustomer`, and clicking Subscribe again started a SECOND Polar subscription. Root cause: a
 * dashboard load BEFORE the company ever checked out cached `hasCompanyCustomer: false` for the full
 * `FACTS_CACHE_MS` window, and nothing invalidated it the moment that answer flipped.
 *
 * Two changes fix it, at two different layers:
 *
 * 1. `invalidateCompanyCustomerFactsCache` below is called at every write site that can flip
 *    `hasCompanyCustomer` from false to true (`checkout-session.ts` right after
 *    `getOrCreatePolarCustomerForCompany` actually resolves a customer, `customer-provisioning.ts`'s own
 *    `persistPolarCustomerId`, `webhook-handlers.ts#applySubscriptionWebhook`'s own
 *    `polarCustomerId` write). This is a real fix, but only within ONE Node process: the cache is a
 *    plain module-level `Map`, and this deployment runs several API replicas behind a load balancer plus
 *    separate worker processes (`entrypoint.sh`'s `ROLE` split) — a webhook landing on the worker, or on
 *    a DIFFERENT API replica than the one that answers the user's next `GET /billing/status`, cannot
 *    reach this process's own `Map` at all. So (1) alone genuinely does NOT fix the reported defect
 *    under the real topology — it only narrows the window in the single-process/test case the reproducing
 *    spec below exercises.
 *
 * 2. `getCompanyCustomerFacts` itself now only caches a CONFIRMED `hasCompanyCustomer: true` (a
 *    successful `getExternal`) or a genuine Polar-outage negative (an unrelated error, where NOT caching
 *    would hammer a currently-failing Polar on every single status poll for the whole outage). A
 *    CONFIRMED absence (a clean 404 — "no company-scoped customer exists, full stop") is never cached at
 *    all: every call re-verifies it directly against Polar, which is shared, durable, cross-process state
 *    every replica and worker reads identically — no invalidation signal needs to travel between
 *    processes for this to be correct. This is the fix that actually holds under the real topology; (1)
 *    is kept anyway because it still shortens the window within a single process (and is what the
 *    reproducing test below exercises directly), and because a future caller that DOES cache negative
 *    results again should not have to rediscover why per-company invalidation matters.
 *
 * Why not the other two options considered: a short TTL for the negative case only shrinks the window,
 * it does not close it — under this topology any TTL still lets a request that lands on a stale replica
 * observe `false` after the fact already flipped elsewhere, so it trades an accidental five minutes for
 * a chosen (smaller) accidental window instead of removing the race. Deriving `hasCompanyCustomer` from
 * `CompanySubscription.polarCustomerId` (the DB row every process already reads, no cache at all) was
 * rejected for a sharper reason: that column also holds a PRE-migration, per-USER customer id
 * (`legacySubscription`'s own whole reason to exist, this file's header above) until a fresh webhook or
 * provisioning pass overwrites it — a company with only a legacy customer would read `hasCompanyCustomer:
 * true` from the DB alone, which is exactly the 2026-09-16 incident this whole module was built to stop
 * recurring (a "Manage subscription" button with nothing company-scoped behind it). Telling a legacy
 * customer apart from a company-scoped one is a Polar-side fact this app's own schema does not carry, so
 * the live check stays required — this fix only changes what the ANSWER "no, not yet" is allowed to cost.
 * A `true` answer is never subject to this distinction (a confirmed company-scoped customer from a live
 * `getExternal` IS the company-scoped one, by construction), which is also why caching a stale `true`
 * stays safe: nothing in this app's normal flow ever deletes a company's own Polar customer.
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
 * Clears ONE company's cached facts — called at every write site that can flip `hasCompanyCustomer`
 * false→true (see this file's own header, "Stale `hasCompanyCustomer: false` caused double billing").
 * Deliberately NOT `resetCompanyCustomerFactsCacheForTests` above: that one wipes EVERY company's entry
 * and exists purely so a spec starts from a clean slate — reusing it here would mean one company
 * finishing checkout silently discards every OTHER company's still-valid cached facts on whichever
 * process happens to run this code path, forcing a needless Polar re-check for accounts that have
 * nothing to do with this write. Only actually closes the reported race within a single Node process —
 * see this file's own header on why `getCompanyCustomerFacts` no longer caching a confirmed-negative
 * answer at all is what makes the fact correct across the real multi-replica/worker topology too.
 */
export function invalidateCompanyCustomerFactsCache(companyId: string): void {
  lastCheckedAtByCompanyId.delete(companyId);
  lastFactsByCompanyId.delete(companyId);
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
  // Only a CONFIRMED "yes" is cached — never a confirmed "no" (the 404 branch above falls through to
  // here with `hasCompanyCustomer` still `false`). See this file's own header: a stale `true` is
  // harmless (nothing in this app's normal flow deletes a company's own Polar customer), but a stale
  // `false` is exactly what let the reported double-billing defect happen, and this is the one change
  // that keeps the answer correct across every replica/worker process rather than just this one — no
  // invalidation signal needs to travel anywhere, the next call simply asks Polar again directly.
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
