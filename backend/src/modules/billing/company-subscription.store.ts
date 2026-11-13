/** The only module that reads or writes `CompanySubscription` rows. */
import prisma from '@/prisma/prisma.service';

import { CompanySubscription, Prisma } from '../../../prisma/generated/prisma/client';
import { computeRecoveredStatus, computeTrialWindow } from './lifecycle';

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
 * Clears fields tied to the vanished subscription. Never clears `polarSubscriptionId` (the permanent
 * "ever paid" signal) or `seats` (last known quantity bought).
 */
export async function recomputeStatusForVanishedSubscription(
  companyId: string,
  trialEndsAt: Date,
  anchor: Date,
  now: Date = new Date(),
): Promise<CompanySubscription> {
  const recovered = computeRecoveredStatus(trialEndsAt, anchor, now);
  return prisma.companySubscription.update({
    where: { companyId },
    data: {
      status: recovered.status,
      blockedAt: recovered.blockedAt,
      interval: null,
      seatPaymentFailedAt: null,
      lastPolarFactAt: anchor,
    },
  });
}

/**
 * A single conditional `updateMany`, not read-then-update, so concurrent requests cannot both open a
 * Polar checkout. Returns the stamped time, or `null` if the window is already held.
 */
export async function reserveCheckoutWindow(
  companyId: string,
  windowMs: number,
  now: Date = new Date(),
): Promise<Date | null> {
  const cutoff = new Date(now.getTime() - windowMs);
  const { count } = await prisma.companySubscription.updateMany({
    where: {
      companyId,
      OR: [{ lastCheckoutStartedAt: null }, { lastCheckoutStartedAt: { lt: cutoff } }],
    },
    data: { lastCheckoutStartedAt: now },
  });
  return count > 0 ? now : null;
}

/** Matched on the reserved timestamp so a stale caller cannot clobber a newer reservation. */
export async function releaseCheckoutWindow(companyId: string, reservedAt: Date): Promise<void> {
  await prisma.companySubscription.updateMany({
    where: { companyId, lastCheckoutStartedAt: reservedAt },
    data: { lastCheckoutStartedAt: null },
  });
}

/** Ensures the row first: a company can get a Polar customer before it has a subscription row. */
export async function recordPolarCustomerId(companyId: string, polarCustomerId: string): Promise<void> {
  await getOrCreateCompanySubscription(companyId);
  await prisma.companySubscription.update({ where: { companyId }, data: { polarCustomerId } });
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
