/**
 * Keeps the company's Polar team-customer members in sync with which users hold OWNER/ADMIN; plain
 * MEMBERs only count toward seat headcount. Called on every membership create, role change, removal and
 * account deletion. A no-op until the company has checked out and Polar has promoted the customer to
 * `team`. Never throws into the caller, so a Polar outage cannot block a membership change; failures are
 * logged and retried on the next change. Adding extra named members may be refused by Polar depending
 * on the organization's B2B member feature, so `create` failures are expected and logged.
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

/** Adds the customer's `type`, to skip member sync until Polar promotes the customer to `"team"`. */
export interface MemberSyncClient extends MemberResolutionClient {
  customers: MemberResolutionClient['customers'] & {
    getExternal(externalId: string): Promise<{ id: string; type: string }>;
  };
}

/** `knownUser` is for callers running after the user row is already deleted (account deletion). */
export async function syncCompanyMemberOnMembershipChange(
  companyId: string,
  userId: string,
  client: MemberSyncClient = getPolarClient() as unknown as MemberSyncClient,
  knownUser?: ResolvedMemberUser,
): Promise<void> {
  if (!isBillingEnabled()) return;

  try {
    const sub = await getOrCreateCompanySubscription(companyId);
    if (!sub.polarSubscriptionId) return; // never checked out, nothing to sync onto

    const customer = await client.customers.getExternal(companyId);
    if (customer.type !== 'team') return; // an `individual` customer has no member subsystem

    // Does not throw, so a failure here cannot skip the per-user sync below.
    await ensureCompanyBillingMember(companyId, customer.id, client);

    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    const shouldHaveAccess = membership ? ROLES_WITH_POLAR_ACCESS.has(membership.role) : false;

    const resolvedUser = knownUser ?? (await loadResolvedUser(userId));
    if (!resolvedUser) return; // deleted concurrently and no knownUser supplied

    if (shouldHaveAccess) {
      await resolveOrCreateMemberIdForUser(client, customer.id, companyId, resolvedUser);
    } else {
      await removeMemberForUser(client, customer.id, companyId, resolvedUser);
    }
  } catch (error) {
    logger.warn('Polar member sync failed, will retry on the next membership change', {
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
 * Ensures the one Polar member standing for the company's billing identity exists and tracks
 * `Company.billingEmail`. Caller must already know `customerId` is a `team` customer. Never throws.
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
    logger.warn('Polar company billing member sync failed, will retry on the next pass', {
      category: 'billing',
      companyId,
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}
