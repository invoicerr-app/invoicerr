/**
 * Permanent company deletion, for both the billing sweep and the owner's manual delete.
 *
 * - A paid company's Polar subscription is revoked first; if that fails, deletion is refused so no
 *   orphaned subscription keeps billing (the sweep retries next tick).
 * - `Webhook.company` is the one relation without `onDelete: Cascade`, so it is deleted explicitly
 *   before the company row.
 * - `User` rows are kept: users can belong to other companies.
 * - Cascading away `DocumentArchive` loses the only pointer to archived bytes, so the storage inventory
 *   is journaled inside the deletion transaction and drained after commit.
 */
import prisma from '@/prisma/prisma.service';
import { sessionCache } from '@/lib/session-cache';
import { companyMemberIds } from '@/modules/companies/company-member-ids';

import {
  drainStorageErasureJournal,
  journalCompanyStorageObjects,
} from '@/modules/documents/archive/company-storage-erasure';

import { CompanySubscriptionStatus } from '../../../prisma/generated/prisma/client';
import { getPolarClient } from './polar-client';

export const POLAR_CANCELLATION_FAILED_CODE = 'POLAR_CANCELLATION_FAILED';

export class PolarCancellationFailedError extends Error {
  readonly code = POLAR_CANCELLATION_FAILED_CODE;

  constructor(
    readonly companyId: string,
    readonly cause: unknown,
  ) {
    super(
      `Could not cancel company ${companyId}'s Polar subscription, refusing to delete the company. ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = 'PolarCancellationFailedError';
  }
}

/** Narrow, mockable subset of the Polar SDK client. `revoke` cancels immediately. */
export interface DeletionPolarClient {
  subscriptions: {
    revoke(id: string): Promise<unknown>;
  };
}

function isStillDueForDeletion(
  sub: { status: CompanySubscriptionStatus; deletionDueAt: Date | null } | null | undefined,
  now: Date,
): boolean {
  return (
    !!sub &&
    sub.status === 'ZIPPED' &&
    sub.deletionDueAt !== null &&
    sub.deletionDueAt.getTime() <= now.getTime()
  );
}

/**
 * Returns `false` when the row is no longer due: the caller's snapshot can be a whole sweep pass old.
 */
export async function deleteCompanyPermanently(
  companyId: string,
  now: Date = new Date(),
  client: DeletionPolarClient = getPolarClient() as unknown as DeletionPolarClient,
): Promise<boolean> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { polarSubscriptionId: true, status: true, deletionDueAt: true },
  });

  if (!isStillDueForDeletion(sub, now)) return false;

  // `polarSubscriptionId` is never cleared once set, so it means the company once paid.
  if (sub?.polarSubscriptionId) {
    try {
      await client.subscriptions.revoke(sub.polarSubscriptionId);
    } catch (error) {
      throw new PolarCancellationFailedError(companyId, error);
    }
  }

  const members = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: a webhook can land during the revoke round-trip above.
    const fresh = await tx.companySubscription.findUnique({
      where: { companyId },
      select: { status: true, deletionDueAt: true },
    });
    if (!isStillDueForDeletion(fresh, now)) return null;

    // Journal only after the guard, or the drain could erase a live company's archives.
    await journalCompanyStorageObjects(tx, companyId);
    await tx.webhook.deleteMany({ where: { companyId } });
    const memberIds = await companyMemberIds(tx, companyId);
    await tx.company.delete({ where: { id: companyId } });
    return memberIds;
  });

  // Drain only after commit: object storage has no rollback. Never throws.
  if (!members) return false;
  await sessionCache.invalidateUsers(members);
  await drainStorageErasureJournal({ companyId, now });
  return true;
}

/**
 * Owner-initiated deletion, not gated on subscription status so companies outside the billing
 * lifecycle can delete themselves. Same revoke-first, webhook and storage rules as above.
 */
export async function deleteCompanyPermanentlyNow(
  companyId: string,
  client: DeletionPolarClient = getPolarClient() as unknown as DeletionPolarClient,
): Promise<void> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { polarSubscriptionId: true },
  });

  if (sub?.polarSubscriptionId) {
    try {
      await client.subscriptions.revoke(sub.polarSubscriptionId);
    } catch (error) {
      throw new PolarCancellationFailedError(companyId, error);
    }
  }

  const members = await prisma.$transaction(async (tx) => {
    await journalCompanyStorageObjects(tx, companyId);
    await tx.webhook.deleteMany({ where: { companyId } });
    const memberIds = await companyMemberIds(tx, companyId);
    await tx.company.delete({ where: { id: companyId } });
    return memberIds;
  });

  await sessionCache.invalidateUsers(members);
  // Must not throw: callers report "nothing was deleted" on error, which would be false by now.
  await drainStorageErasureJournal({ companyId });
}
