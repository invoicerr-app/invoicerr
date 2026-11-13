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
 * Creates the row lazily on first use, so a company that predates the billing flag starts its trial
 * then, never backdated. `upsert` so concurrent first touches do not hit the unique constraint.
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
 * Row lock used to serialize all seat bookkeeping for one company. The caller must ensure the row
 * exists first: `FOR UPDATE` on a missing row silently locks nothing.
 */
export async function lockCompanySubscriptionRow(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM company_subscription WHERE "companyId" = ${companyId} FOR UPDATE`;
}

export async function listAdvanceableCompanySubscriptions(): Promise<CompanySubscription[]> {
  return prisma.companySubscription.findMany({ where: { status: { not: 'DELETED' } } });
}

/** Side-effect-free read: the Terms exemption check must never create a subscription row. */
export async function findCompanySubscription(companyId: string): Promise<CompanySubscription | null> {
  return prisma.companySubscription.findUnique({ where: { companyId } });
}
