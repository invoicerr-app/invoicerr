/**
 * Syncs a user's confirmed email change to their Polar members (OWNER/ADMIN of `team` customers only).
 * Polar's auto-created owner member is matched by email and cannot be re-keyed, so once the email
 * changes a fresh member is created instead. Never throws: a Polar outage must not fail the caller.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { isResourceNotFoundError } from './billing-customer';
import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  MemberResolutionClient,
  ResolvedMemberUser,
  resolveOrCreateMemberIdForUser,
} from './member-resolution';
import { callPolarWithRetry, getPolarClient } from './polar-client';

const ROLES_WITH_POLAR_ACCESS = ['OWNER', 'ADMIN'] as const;

export interface MemberEmailSyncClient extends MemberResolutionClient {
  customers: MemberResolutionClient['customers'] & {
    getExternal(externalId: string): Promise<{ id: string; type: string }>;
    members: MemberResolutionClient['customers']['members'] & {
      updateExternal(
        externalId: string,
        memberExternalId: string,
        body: { email?: string | null; name?: string | null },
      ): Promise<{ id: string }>;
    };
  };
}

export async function syncPolarMemberEmailForUser(
  userId: string,
  newEmail: string,
  name: string | null,
  client: MemberEmailSyncClient = getPolarClient() as unknown as MemberEmailSyncClient,
): Promise<void> {
  if (!isBillingEnabled()) return;

  try {
    const memberships = await prisma.userCompany.findMany({
      where: { userId, role: { in: [...ROLES_WITH_POLAR_ACCESS] } },
      select: { companyId: true },
    });

    for (const { companyId } of memberships) {
      await syncOneCompany(client, companyId, { id: userId, email: newEmail, name });
    }
  } catch (error) {
    logger.warn('Polar member email sync failed, will retry on the next membership-driven sync', {
      category: 'billing',
      details: { userId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function syncOneCompany(
  client: MemberEmailSyncClient,
  companyId: string,
  user: ResolvedMemberUser,
): Promise<void> {
  const sub = await getOrCreateCompanySubscription(companyId);
  if (!sub.polarSubscriptionId) return;

  let customer: { id: string; type: string };
  try {
    customer = await callPolarWithRetry(
      () => client.customers.getExternal(companyId),
      `customers.getExternal for company ${companyId}`,
    );
  } catch (error) {
    if (isResourceNotFoundError(error)) return;
    throw error;
  }
  if (customer.type !== 'team') return;

  try {
    await callPolarWithRetry(
      () =>
        client.customers.members.updateExternal(companyId, user.id, {
          email: user.email,
          name: user.name ?? undefined,
        }),
      `members.updateExternal for user ${user.id} in company ${companyId}`,
    );
    return;
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  // Either no member exists yet, or it is Polar's auto-created owner member, unreachable by its old
  // email. Resolve-or-create under the current identity.
  await resolveOrCreateMemberIdForUser(client, customer.id, companyId, user);
}
