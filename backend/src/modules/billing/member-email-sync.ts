/**
 * Keeps a Polar MEMBER's email in sync with the Invoicerr USER it belongs to, once that user's OWN
 * email change is confirmed (`lib/auth.ts`'s `databaseHooks.user.update.after` — the hook that fires
 * once better-auth actually commits the new, verified address, not the moment the confirmation link is
 * merely SENT — see `account-lifecycle.ts#sendChangeEmailMail`'s own header for that earlier step).
 *
 * Two kinds of Polar member a user can hold, per company (`member-resolution.ts`'s own header):
 *  1. An APP-CREATED member (`externalId = user.id`) — its email is pushed DIRECTLY via
 *     `customers.members.updateExternal`, keyed by that stable externalId, unaffected by the email
 *     change itself.
 *  2. Polar's OWN auto-created `role: "owner"` member — minted from "the customer's email and name" on
 *     the company's first seat-based checkout, matched everywhere else in this codebase by EMAIL
 *     (`findMemberIdForUser`'s own fallback) because it carries no `externalId` this app ever set. Once
 *     the user's email changes, that record's OWN (now stale) email can no longer be matched — there is
 *     no Polar API to "rename" a member found this way onto a NEW lookup key, so rather than leave the
 *     user without any member at all, a FRESH one is created under the new email/externalId. This is
 *     exactly the "updated OR recreated" the product decision allows for.
 *
 * Only touches companies where this user holds OWNER/ADMIN (a plain MEMBER never gets a Polar member at
 * all — `member-sync.ts`'s own header) and that have already been promoted to a `team` customer (a
 * company that never checked out, or never ran a seat-based checkout, has no member subsystem to sync
 * at all). Never throws into its caller — same "a Polar outage must not turn an unrelated write into a
 * 500" discipline every other billing sync module holds.
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

/** `member-resolution.ts`'s own client shape, plus the two extra calls this module needs on top of it
 *  — the customer's own `type` (`member-sync.ts`'s own reason for the same extension) and
 *  `members.updateExternal` (`@polar-sh/sdk`'s `CustomersMembersUpdateExternalRequest`, read directly:
 *  "Update a member by external ID for a customer identified by its external ID"). */
export interface MemberEmailSyncClient extends MemberResolutionClient {
  customers: MemberResolutionClient['customers'] & {
    getExternal(request: { externalId: string }): Promise<{ id: string; type: string }>;
    members: MemberResolutionClient['customers']['members'] & {
      updateExternal(request: {
        externalId: string;
        memberExternalId: string;
        memberUpdate: { email?: string | null; name?: string | null };
      }): Promise<{ id: string }>;
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
    logger.warn('Polar member email sync failed — will retry on the next membership-driven sync', {
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
  if (!sub.polarSubscriptionId) return; // never checked out — nothing to sync members onto yet.

  let customer: { id: string; type: string };
  try {
    customer = await callPolarWithRetry(
      () => client.customers.getExternal({ externalId: companyId }),
      `customers.getExternal for company ${companyId}`,
    );
  } catch (error) {
    if (isResourceNotFoundError(error)) return;
    throw error;
  }
  if (customer.type !== 'team') return; // no member subsystem yet — see this module's own header.

  try {
    await callPolarWithRetry(
      () =>
        client.customers.members.updateExternal({
          externalId: companyId,
          memberExternalId: user.id,
          memberUpdate: { email: user.email, name: user.name ?? undefined },
        }),
      `members.updateExternal for user ${user.id} in company ${companyId}`,
    );
    return; // app-created member found and updated in place — done.
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  // No app-created member — either none exists yet, or it is Polar's own auto-created owner member,
  // now unreachable by its OLD email (see this module's own header). Either way, resolve-or-create
  // under the user's CURRENT identity.
  await resolveOrCreateMemberIdForUser(client, customer.id, companyId, user);
}
