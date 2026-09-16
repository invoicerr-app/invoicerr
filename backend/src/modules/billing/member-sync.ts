/**
 * Keeps this company's Polar TEAM-customer members in sync with which of its users hold OWNER/ADMIN
 * (product decision 2026-09-16's multi-user follow-up): a user who becomes OWNER/ADMIN of an
 * ALREADY-SUBSCRIBED company gets a Polar member (via `member-resolution.ts`); demoted to MEMBER, or
 * removed from the company entirely, loses it. A plain MEMBER never gets a Polar member at all — only
 * OWNER/ADMIN can ever open checkout/portal (`@Roles` on `billing.controller.ts`), a MEMBER counts
 * purely as a billed SEAT (`seat-sync.ts`, unchanged).
 *
 * Called from the SAME call sites `seat-sync.ts#syncCompanySeatsOnMembershipChange` already is
 * (that file's own header) PLUS `companies.service.ts#changeMemberRole` — a role change alone never
 * touches the SEAT count (the person was already counted), but it DOES gain or lose Polar member
 * access.
 *
 * A no-op — never even reads Prisma's `UserCompany` — before the company has ever completed a
 * checkout (`polarSubscriptionId` unset, same "nothing to push to Polar yet" guard `seat-sync.ts`
 * holds) or before Polar has promoted that customer to `type: "team"` (an `individual` customer has no
 * member subsystem — see `portal-session.ts`'s own header on the seat-based-checkout promotion).
 * NEVER throws into its caller — same "a Polar outage must not block a role change/removal/invitation
 * accept" discipline `seat-sync.ts` holds; a failed create/delete is logged and left for the NEXT
 * membership change to retry.
 *
 * `PolarMembers.delete`/`deleteExternal` DO exist in `@polar-sh/sdk@0.49` (confirmed by reading
 * `node_modules/@polar-sh/sdk/dist/commonjs/sdk/polarmembers.d.ts` directly, 2026-09-16) — member
 * REMOVAL is not blocked by a missing API. What
 * remains genuinely unverified (Polar's own docstring on `create`: "Only B2B customers with the member
 * management feature enabled can add members" — no dashboard flag or plan requirement found in Polar's
 * own docs) is whether every organization can call `create`/`createExternal` for an ADDITIONAL named
 * member the way the auto-created owner member proved live in sandbox; caught and logged like every
 * other Polar failure here, never assumed to always succeed.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  MemberResolutionClient,
  removeMemberForUser,
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
