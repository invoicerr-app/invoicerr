/**
 * Permanent company deletion, for both the billing sweep and the owner's manual delete.
 *
 * Almost every relation onto `Company` in `schema.prisma` is `onDelete: Cascade` (verified directly:
 * of the 32 `<field> Company @relation(...)` lines in the schema, 31 carry it), so
 * `prisma.company.delete` alone already removes the company's clients, documents, invitations,
 * channel configs… and its own `CompanySubscription` row, which is exactly why `lifecycle.ts`'s own
 * header notes that no row is ever actually read back with `status: 'DELETED'`: the row disappears in
 * the same statement that would have written it.
 *
 * `Webhook.company` is the ONE exception (`model Webhook`, schema.prisma): its relation carries no
 * `onDelete` clause at all, so Postgres's default (`NO ACTION`) would make `company.delete` fail
 * outright with a foreign-key violation for any company that ever configured a webhook. Rather than
 * touch that unrelated model's own migration history for this feature, this function deletes that
 * ONE leftover table explicitly, in the same transaction, strictly BEFORE the company row itself —
 * literally "FK order" for the single case where the schema does not already give it for free.
 *
 * Deliberately does NOT touch `User` rows: a user can belong to other companies, and even one whose
 * last membership was this company is a login/identity the product brief never asked this feature to
 * remove, only the COMPANY and everything scoped to it.
 *
 * ## Never delete from a stale read
 *
 * This function's caller (`billing-lifecycle-sweep-runner.ts#applyOne`) decides `delete_company` from
 * a snapshot that can be an entire sweep pass old by the time this specific company's turn comes up —
 * a company that paid again in the meantime must never be deleted anyway. `isStillDueForDeletion` is
 * checked TWICE: once up front (skip the whole thing cheaply for the common case), and again INSIDE
 * the deletion transaction itself, immediately before `company.delete`, so a row that moved on since
 * the first read is never deleted. Returns whether it actually
 * deleted, rather than assuming success, so the caller's own `deleted` counter stays honest.
 *
 * ## The company's STORED BYTES go too, and their inventory is written before the rows go
 *
 * Cascading `DocumentInstance` → `DocumentArchive` away also destroys `DocumentArchive.uri`, the only
 * pointer this product ever had to an archived document's bytes (the archive path carries no
 * `companyId` at all). Both functions below therefore call `journalCompanyStorageObjects` INSIDE the
 * deletion transaction, before any delete statement, and drain that journal once it has committed —
 * see `documents/archive/company-storage-erasure.ts`'s own header for why the inventory, not the
 * object deletion, is what has to precede the rows, and for how ⚖ statutory retention interacts with
 * an erasure request. Both deletion routes are wired, deliberately: the automated billing sweep and
 * the OWNER's own "delete company" are the SAME irreversible act and must not differ on what they
 * leave behind.
 *
 * ## Stripe stops billing first
 *
 * Both routes cancel the company's Stripe subscriptions (`stripe-subscription-cancel.ts`) before the
 * deletion transaction, and a failed cancellation aborts the deletion: a company must never be gone
 * while Stripe keeps charging it.
 */
import prisma from '@/prisma/prisma.service';
import { sessionCache } from '@/lib/session-cache';
import { companyMemberIds } from '@/modules/companies/company-member-ids';

import {
  drainStorageErasureJournal,
  journalCompanyStorageObjects,
} from '@/modules/documents/archive/company-storage-erasure';

import { CompanySubscriptionStatus } from '../../../prisma/generated/prisma/client';
import { cancelCompanyStripeSubscriptions } from './stripe-subscription-cancel';

/** `true` only when the row, as just read, is STILL actually due for deletion, `null`/`undefined`
 *  covers both "no such row" (should not happen once a company reaches ZIPPED) and "the row already
 *  vanished". Shared by the up-front check and the in-transaction re-check below so the two can
 *  never silently drift apart on what "due" means. */
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
export async function deleteCompanyPermanently(companyId: string, now: Date = new Date()): Promise<boolean> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { status: true, deletionDueAt: true },
  });

  if (!isStillDueForDeletion(sub, now)) return false;

  // A ZIPPED company has usually stopped paying long ago, but a subscription left `unpaid` or
  // `paused` is still live on Stripe's side. Throws on failure: the sweep retries next tick.
  await cancelCompanyStripeSubscriptions(companyId);

  const members = await prisma.$transaction(async (tx) => {
    // Re-read INSIDE the same transaction as the delete itself, right before it: a billing event
    // can land between the check above and this point. A row that moved on in that window must
    // abort here, the DB delete never runs, rather than trusting a read that is, by construction,
    // at least one await old by the time it gets here.
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
 * Manual, OWNER-INITIATED deletion, "Delete company" in the danger zone (`danger/danger.service.ts`).
 * Unlike `deleteCompanyPermanently` above, this is never driven by `CompanySubscription.status`/
 * `deletionDueAt`: an OWNER who cleared the OTP challenge AND retyped the company's own exact name
 * already IS the "due" signal there is to have, gating this on `status === 'ZIPPED'` the same way
 * would make a company that never entered the billing lifecycle at all (self-hosted, no
 * `CompanySubscription` row, or a paying company that has simply never missed a payment) unable to
 * ever delete itself. The two non-negotiable disciplines `deleteCompanyPermanently` enforces stay
 * exactly as strict here: `Webhook` is deleted explicitly before `Company` (see this file's own
 * header on why that one relation alone needs it); and the company's stored bytes are inventoried in
 * the same transaction, then erased, identically to the automated path, because an OWNER exercising
 * erasure and a billing sweep closing an account must not leave different amounts of the customer
 * behind on disk.
 */
export async function deleteCompanyPermanentlyNow(companyId: string): Promise<void> {
  // A paying company deleting itself must stop being charged. Throws on failure, before any row is
  // touched, so "nothing was deleted" stays true for the caller.
  await cancelCompanyStripeSubscriptions(companyId);

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
