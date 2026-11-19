/**
 * Purely LOCAL seat bookkeeping: the bought quantity (`CompanySubscription.seats`) is a fact this module
 * reads, never one it writes, and nothing here calls the payment provider.
 *
 * It covers the generative "Settings > Seats" office plan:
 * a numbered desk (`UserCompany.seatIndex`) assigned to the first free integer the moment a NEW
 * membership is created, and a capacity refusal
 * (`NoFreeSeatError`) for the "a company must not exceed the seats it actually bought" rule at the
 * exact moment a membership WOULD be created — never for a role change or removal, neither of which
 * needs a new desk. Called from EVERY "a brand-new membership is being created" call site, which is
 * what makes the capacity rule a property of the company rather than of one entry door:
 *  - `company/company.service.ts` — a brand-new company's own OWNER row (createCompany);
 *  - `invitations/invitations.service.ts` — an EXISTING user accepting an invitation (useInvitation);
 *  - `lib/auth.ts` — a BRAND-NEW user signing up via an invitation code or their company's own SSO
 *    (`markInvitationAsUsed`/`attachSsoProvisionedMembership`);
 *  - `company/transfer/transfer.service.ts` — the recipient of an ownership transfer accepting it
 *    (`acceptTransfer`). An accepted transfer ADDS a member: the initiator is demoted to ADMIN and
 *    keeps their own membership, they are not replaced.
 *
 * Deliberately NOT called any more from `companies.service.ts#removeMember` or
 * `auth-extended/account-lifecycle.ts#cleanupAfterUserDelete`: freeing a desk on removal needs no
 * explicit step — the `UserCompany` row (and whatever `seatIndex` it held) is simply deleted, and
 * `seat-holders.ts#seatHolders` recomputes who is seated/waiting live from whatever rows remain, every
 * time it is asked. Nor from `companies.service.ts#changeMemberRole` — a role change never creates or
 * destroys a membership row, so there is no new desk to assign (an OWNER promotion still keeps
 * whichever desk, if any, that member already had).
 *
 * ## Concurrent membership changes for the SAME company
 *
 * Two membership changes landing at (almost) the same instant — two invitations accepted together, an
 * SSO burst provisioning ten users at once — must never (a) hand out the SAME `seatIndex` to two
 * different new rows, or (b) let two callers both read "one seat left" and both succeed, overshooting
 * the bought quantity by one. Both are solved with
 * a `SELECT … FOR UPDATE` row lock on the company's own `company_subscription` row, held for the
 * entire check-then-create-then-assign sequence (`withSeatReservation` below) — chosen over a BullMQ
 * per-company job because membership changes are synchronous, inline
 * with the request that causes them, and a queue hop would turn "accept an invitation" into an
 * eventually-consistent operation for no benefit.
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
    super(`Company ${companyId} has no free seat - add one in the billing settings.`);
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
 * Runs `createMembership` (the caller's own `UserCompany` create/upsert) as the ONE atomic step that
 * also (a) refuses with `NoFreeSeatError` when the company has no free seat — but ONLY if `userId` is
 * not ALREADY a member, so re-opening a stale invitation link (or a repeat SSO callback) for someone
 * already in the company stays the harmless no-op it always was, never a spurious capacity refusal —
 * and (b) assigns the new row the lowest free `seatIndex`, for a membership that is genuinely new.
 *
 * A no-op wrapper (still runs `createMembership`, no lock, no capacity check, no seat index) when
 * billing is disabled — a self-hosted instance pays nothing extra for a concept ("bought seats") it has
 * no subscription to have bought in the first place.
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
