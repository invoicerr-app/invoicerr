/**
 * Keeps this company's Polar TEAM-customer members in sync with which of its users hold OWNER/ADMIN
 * (product decision 2026-09-16's multi-user follow-up): a user who becomes OWNER/ADMIN of an
 * ALREADY-SUBSCRIBED company gets a Polar member (via `member-resolution.ts`); demoted to MEMBER, or
 * removed from the company entirely, loses it. A plain MEMBER never gets a Polar member at all — only
 * OWNER/ADMIN can ever open checkout/portal (`@Roles` on `billing.controller.ts`), a MEMBER counts
 * purely toward the seat HEADCOUNT `seat-sync.ts` checks against the bought quantity — a different
 * concern this file never touches.
 *
 * Called from every place a `UserCompany` row is created, changed, or removed — company creation,
 * invitation acceptance, SSO auto-provisioning, `companies.service.ts#changeMemberRole`, member
 * removal, and account deletion — a broader set than `seat-sync.ts#withSeatReservation`'s own three
 * call sites (creation only): a role change or removal never creates/destroys a membership row (no new
 * desk to assign, no capacity to re-check), but it DOES gain or lose Polar member access, which is this
 * file's own, separate concern.
 *
 * A no-op — never even reads Prisma's `UserCompany` — before the company has ever completed a
 * checkout (`polarSubscriptionId` unset, same "nothing to sync yet" guard `seat-sync.ts` holds for its
 * own capacity check) or before Polar has promoted that customer to `type: "team"` (an `individual`
 * customer has no member subsystem — see `portal-session.ts`'s own header on the seat-based-checkout
 * promotion). NEVER throws into its caller — same "a Polar outage must not block a role
 * change/removal/invitation accept" discipline `seat-sync.ts` holds; a failed create/delete is logged
 * and left for the NEXT membership change to retry.
 *
 * `PolarMembers.delete`/`deleteExternal` DO exist in `@polar-sh/sdk@0.49` (confirmed by reading
 * `node_modules/@polar-sh/sdk/dist/commonjs/sdk/polarmembers.d.ts` directly, 2026-09-16) — member
 * REMOVAL is not blocked by a missing API. What
 * remains genuinely unverified (Polar's own docstring on `create`: "Only B2B customers with the member
 * management feature enabled can add members" — no dashboard flag or plan requirement found in Polar's
 * own docs) is whether every organization can call `create`/`createExternal` for an ADDITIONAL named
 * member the way the auto-created owner member proved live in sandbox; caught and logged like every
 * other Polar failure here, never assumed to always succeed.
 *
 * Also owns `ensureCompanyBillingMember` (below) — a SEPARATE concern from the per-user sync above (it
 * never reads `UserCompany` at all), grouped in this file because both need the exact same "only once
 * this company is a `team` customer" guard. Ensures the ONE Polar member standing for the company's own
 * billing identity (`member-resolution.ts#resolveOrCreateCompanyBillingMemberId`) exists PROACTIVELY —
 * at every membership change (called from `syncCompanyMemberOnMembershipChange` itself) and at
 * `customer-provisioning.ts`'s own boot/sweep pass — rather than only lazily, the first time someone
 * actually clicks "Manage subscription" (`portal-session.ts` already resolves-or-creates it lazily too,
 * so this is defense in depth: warms the common case and keeps `Company.billingEmail` changes reflected
 * even for a company nobody re-opens the portal for).
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { loadCompanyBillingIdentity, resolveBillingEmail } from './billing-customer';
import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  MemberResolutionClient,
  removeMemberForUser,
  resolveOrCreateCompanyBillingMemberId,
  ResolvedMemberUser,
  resolveOrCreateMemberIdForUser,
} from './member-resolution';
import { getPolarClient } from './polar-client';

const ROLES_WITH_POLAR_ACCESS = new Set(['OWNER', 'ADMIN']);

/** `member-resolution.ts`'s own client shape, plus the one extra call this module needs on top of it:
 *  the customer's own `type`, to skip member sync entirely for a customer Polar has not promoted to
 *  `"team"` yet (see this file's own header). */
export interface MemberSyncClient extends MemberResolutionClient {
  customers: MemberResolutionClient['customers'] & {
    getExternal(request: { externalId: string }): Promise<{ id: string; type: string }>;
  };
}

/**
 * `knownUser` — passed ONLY by `account-lifecycle.ts#cleanupAfterUserDelete`: by the time that caller
 * runs, `prisma.user.findUnique({ id: userId })` would find nothing (the row already cascaded away),
 * so it passes better-auth's own still-in-memory identity instead. Every OTHER call site omits it and
 * this function reads Prisma itself, the normal path.
 */
export async function syncCompanyMemberOnMembershipChange(
  companyId: string,
  userId: string,
  client: MemberSyncClient = getPolarClient() as unknown as MemberSyncClient,
  knownUser?: ResolvedMemberUser,
): Promise<void> {
  if (!isBillingEnabled()) return;

  try {
    const sub = await getOrCreateCompanySubscription(companyId);
    if (!sub.polarSubscriptionId) return; // never checked out — nothing to sync members onto yet.

    const customer = await client.customers.getExternal({ externalId: companyId });
    if (customer.type !== 'team') return; // no member subsystem yet — see this file's own header.

    // Best-effort, same as everything else in this try block — a failure here must not skip the
    // per-user sync below, so it is NOT allowed to throw out of this call (see its own header).
    await ensureCompanyBillingMember(companyId, customer.id, client);

    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    const shouldHaveAccess = membership ? ROLES_WITH_POLAR_ACCESS.has(membership.role) : false;

    const resolvedUser = knownUser ?? (await loadResolvedUser(userId));
    if (!resolvedUser) return; // deleted concurrently, and no knownUser was supplied — nothing to sync.

    if (shouldHaveAccess) {
      await resolveOrCreateMemberIdForUser(client, customer.id, companyId, resolvedUser);
    } else {
      await removeMemberForUser(client, customer.id, companyId, resolvedUser);
    }
  } catch (error) {
    logger.warn('Polar member sync failed — will retry on the next membership change', {
      category: 'billing',
      companyId,
      details: { companyId, userId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function loadResolvedUser(userId: string): Promise<ResolvedMemberUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstname: true, lastname: true },
  });
  if (!user) return null;
  return { id: userId, email: user.email, name: `${user.firstname} ${user.lastname}`.trim() || null };
}

/**
 * Makes sure the ONE Polar member standing for this company's own billing identity exists (and, on a
 * `Company.billingEmail` change, ends up pointing at a member with the NEW email — see
 * `member-resolution.ts#resolveOrCreateCompanyBillingMemberId`'s own header on when that means
 * reusing Polar's auto-created owner member versus creating a fresh one). Callers own the "is this
 * customer actually a `team` customer yet" guard (both call sites here already checked it for their
 * own, adjacent reason) — this function assumes `customerId` names one. Never throws: a Polar hiccup
 * here must not turn an unrelated membership-change or provisioning pass into a failure — logged and
 * left for the NEXT call (every membership change, every provisioning/sweep pass) to retry.
 */
export async function ensureCompanyBillingMember(
  companyId: string,
  customerId: string,
  client: MemberResolutionClient = getPolarClient() as unknown as MemberResolutionClient,
): Promise<void> {
  try {
    const identity = await loadCompanyBillingIdentity(companyId);
    await resolveOrCreateCompanyBillingMemberId(client, customerId, companyId, {
      email: resolveBillingEmail(identity),
      name: identity.name,
    });
  } catch (error) {
    logger.warn('Polar company billing member sync failed — will retry on the next pass', {
      category: 'billing',
      companyId,
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}
