/**
 * The one place `CompanySubscription` rows are read/written from Prisma — every other billing file
 * (`send-gate.ts`, `seat-sync.ts`, `billing-lifecycle-sweep-runner.ts`, `billing.controller.ts`,
 * `webhook-handlers.ts`) goes through this module rather than calling `prisma.companySubscription`
 * itself, the same "one narrow persistence seam" discipline `documents/persistence.ts` holds for the
 * documents module.
 */
import prisma from '@/prisma/prisma.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { computeTrialWindow } from './lifecycle';

/**
 * Returns this company's subscription row, creating it LAZILY (status TRIAL, a fresh 7-day window
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

/** Every subscription NOT already terminal (`DELETED`) — what the lifecycle sweep walks each tick.
 *  `DELETED` is excluded even though `deletion.ts`'s own header notes no row should ever actually be
 *  read back in that state (deleting `Company` cascades the row away) — kept as a defensive filter
 *  rather than trusting that invariant blindly. */
export async function listAdvanceableCompanySubscriptions(): Promise<CompanySubscription[]> {
  return prisma.companySubscription.findMany({ where: { status: { not: 'DELETED' } } });
}
