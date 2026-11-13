/**
 * The one place `CompanySubscription` rows are read/written from Prisma — every other billing file
 * (`send-gate.ts`, `seat-sync.ts`, `billing-lifecycle-sweep-runner.ts`, `billing.controller.ts`)
 * goes through this module rather than calling `prisma.companySubscription` itself, the same "one narrow persistence seam" discipline `documents/persistence.ts` holds for the
 * documents module.
 */
import prisma from '@/prisma/prisma.service';

import { CompanySubscription, Prisma } from '../../../prisma/generated/prisma/client';
import { computeTrialWindow } from './lifecycle';

/**
 * Returns this company's subscription row, creating it LAZILY (status TRIAL, a fresh 14-day window
 * starting `now`) the first time anything asks. This is what makes "no retroactive enrolment" true:
 * an existing company that predates the billing flag simply has no row until the first time it is
 * actually needed (a send attempt, a `GET /api/billing/status`, a membership change) — at which point
 * its trial is deemed to start THEN, never backdated to when the flag first flipped or to the
 * company's own `createdAt`.
 *
 * `upsert`, not `findUnique` then `create`: two concurrent first-touches (e.g. two tabs both hitting
 * `GET /api/billing/status` for a brand-new company) must not race into a duplicate-key error against
 * the `companyId` unique constraint — the loser's `create` clause simply never applies, and it reads
 * back whatever the winner wrote (`update: {}`, a genuine no-op) instead.
 */
export async function getOrCreateCompanySubscription(
  companyId: string,
  now: Date = new Date(),
): Promise<CompanySubscription> {
  const existing = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (existing) return existing;

  const { trialStartedAt, trialEndsAt } = computeTrialWindow(now);
  return prisma.companySubscription.upsert({
    where: { companyId },
    create: { companyId, trialStartedAt, trialEndsAt },
    update: {},
  });
}

/**
 * Takes a `SELECT … FOR UPDATE` row lock on this company's own `company_subscription` row, held for
 * the rest of `tx`'s own transaction — the ONE place this exact lock is issued, shared by every seat
 * bookkeeping operation that must not race another one for the SAME company:
 * `seat-sync.ts#withSeatReservation` (a new membership's capacity check + desk assignment),
 * `seats-view.ts#ensureSeatIndexesAssigned` (backfilling a stale/missing desk number) and
 * `seats-view.ts#moveMemberSeat` (an OWNER/ADMIN dragging a member onto a specific desk). None of these
 * callers necessarily need to CHANGE this row itself — they lock it purely to serialize against each
 * other, because `company_subscription` is the one row per company every seat-related decision is
 * already scoped by, so it doubles as this lock's own natural key. The caller is responsible for making
 * sure the row exists first (`getOrCreateCompanySubscription`) — a `SELECT … FOR UPDATE` against a
 * nonexistent row locks nothing and returns no error, which would silently defeat the whole point.
 */
export async function lockCompanySubscriptionRow(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM company_subscription WHERE "companyId" = ${companyId} FOR UPDATE`;
}

/** Every subscription NOT already terminal (`DELETED`) — what the lifecycle sweep walks each tick.
 *  `DELETED` is excluded even though `deletion.ts`'s own header notes no row should ever actually be
 *  read back in that state (deleting `Company` cascades the row away) — kept as a defensive filter
 *  rather than trusting that invariant blindly. */
export async function listAdvanceableCompanySubscriptions(): Promise<CompanySubscription[]> {
  return prisma.companySubscription.findMany({ where: { status: { not: 'DELETED' } } });
}

/**
 * A plain, side-effect-free read — `null` for a Company with no row at all, rather than the LAZY
 * `getOrCreateCompanySubscription`'s own upsert. The one caller this exists for
 * (`legal/terms-paid-period-exemption.ts`, the Terms of Service Section 20.2 exception) must never
 * itself CREATE a subscription row as a side effect of merely checking whether a pending legal
 * re-acceptance should be excused — `CompanyWriteGuard` (`company-write.guard.ts`), registered ahead of
 * `LegalAcceptanceGuard` in `app.module.ts`, already lazily creates the row for every write request
 * before this ever runs, but this function deliberately does not rely on that ordering: a Company with
 * genuinely no row yet has no subscription period to protect either way, so `null` here reads exactly
 * the same as a fresh `TRIAL` row would (no exception) without this module ever writing anything.
 */
export async function findCompanySubscription(companyId: string): Promise<CompanySubscription | null> {
  return prisma.companySubscription.findUnique({ where: { companyId } });
}
