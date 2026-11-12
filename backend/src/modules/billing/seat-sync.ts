/**
 * Seat quantity is bought in the Polar portal and only ever read here (webhooks, `seat-reconcile.ts`);
 * this module must never call `subscriptions.update`, which `no-seat-quantity-write.spec.ts` guards.
 *
 * What it does own is local bookkeeping at membership creation: a capacity check and a desk number
 * (`seatIndex`). Every call site that creates a new membership must go through `withSeatReservation`,
 * so capacity is a property of the company rather than of one entry point. Removals and role changes
 * need no step: `seatHolders` recomputes from the remaining rows.
 *
 * Concurrent creations for the same company are serialized with a `FOR UPDATE` lock on its
 * `company_subscription` row, so two callers cannot share a `seatIndex` or both take the last seat.
 */
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../prisma/generated/prisma/client';
import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription, lockCompanySubscriptionRow } from './company-subscription.store';

export async function countCompanySeats(companyId: string): Promise<number> {
  return prisma.userCompany.count({ where: { companyId } });
}

export const NO_FREE_SEAT_CODE = 'NO_FREE_SEAT';

/** A plain `Error`, not an `HttpException`, because `lib/auth.ts` calls this outside Nest and maps it
 *  to a better-auth `APIError`. */
export class NoFreeSeatError extends Error {
  readonly code = NO_FREE_SEAT_CODE;

  constructor(readonly companyId: string) {
    super(`Company ${companyId} has no free seat — add one in the Polar portal.`);
    this.name = 'NoFreeSeatError';
  }
}

/** Desk numbering starts at 1. */
function firstFreeIndex(usedIndexes: Iterable<number>): number {
  const used = new Set(usedIndexes);
  let index = 1;
  while (used.has(index)) index++;
  return index;
}

/**
 * Runs `createMembership` atomically with the capacity check and `seatIndex` assignment. An existing
 * member (stale invitation link, repeat SSO callback) skips both so it is never refused for capacity.
 * Without billing, it just runs `createMembership`.
 */
export async function withSeatReservation<T>(
  companyId: string,
  userId: string,
  createMembership: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isBillingEnabled()) {
    return prisma.$transaction((tx) => createMembership(tx));
  }

  // A brand-new company has no `company_subscription` row to lock yet.
  await getOrCreateCompanySubscription(companyId);

  return prisma.$transaction(
    async (tx) => {
      await lockCompanySubscriptionRow(tx, companyId);

      const alreadyMember = await tx.userCompany.findUnique({
        where: { userId_companyId: { userId, companyId } },
        select: { id: true },
      });

      if (!alreadyMember) {
        const [sub, headcount] = await Promise.all([
          tx.companySubscription.findUniqueOrThrow({ where: { companyId } }),
          tx.userCompany.count({ where: { companyId } }),
        ]);
        if (headcount >= sub.seats) {
          throw new NoFreeSeatError(companyId);
        }
      }

      const result = await createMembership(tx);

      if (!alreadyMember) {
        const used = await tx.userCompany.findMany({
          where: { companyId, seatIndex: { not: null } },
          select: { seatIndex: true },
        });
        await tx.userCompany.update({
          where: { userId_companyId: { userId, companyId } },
          data: { seatIndex: firstFreeIndex(used.map((row) => row.seatIndex!)) },
        });
      }

      return result;
    },
    // The lock is held through the caller's own writes, so leave room beyond Prisma's 5s default.
    { timeout: 15_000 },
  );
}
