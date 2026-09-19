/**
 * Invoicerr never tells Polar how many seats to bill — it only reads what Polar says. This file used
 * to push `count(UserCompany rows)` to Polar via `subscriptions.update({ seats })` on every membership
 * change (see git history for the removed `performSeatSync`); that entire push is gone. Seat QUANTITY
 * is bought in the Polar portal by the OWNER and arrives here exclusively via `webhook-handlers.ts` (a
 * `subscription.*` webhook's own `seats` field) and `seat-reconcile.ts`'s opportunistic read-and-store
 * retry — this module never calls `subscriptions.update` at all. `no-seat-quantity-write.spec.ts` is a
 * standing, file-content guard against this regressing.
 *
 * What replaced the push is purely LOCAL bookkeeping for the generative "Settings > Seats" office plan:
 * a numbered desk (`UserCompany.seatIndex`) assigned to the first free integer the moment a NEW
 * membership is created, and a capacity refusal
 * (`NoFreeSeatError`) for the "a company must not exceed the seats it actually bought" rule at the
 * exact moment a membership WOULD be created — never for a role change or removal, neither of which
 * needs a new desk. Called from the SAME three "a brand-new membership is being created" call sites the
 * old push used to also cover:
 *  - `company/company.service.ts` — a brand-new company's own OWNER row (createCompany);
 *  - `invitations/invitations.service.ts` — an EXISTING user accepting an invitation (useInvitation);
 *  - `lib/auth.ts` — a BRAND-NEW user signing up via an invitation code or their company's own SSO
 *    (`markInvitationAsUsed`/`attachSsoProvisionedMembership`).
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
 * the bought quantity by one. Both are solved the same way the REMOVED Polar push used to solve its own
 * race: a `SELECT … FOR UPDATE` row lock on the company's own `company_subscription` row, held for the
 * entire check-then-create-then-assign sequence (`withSeatReservation` below) — chosen over a BullMQ
 * per-company job for the same reason the old push was: membership changes are synchronous, inline
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

/** Thrown by `withSeatReservation` when a company already has as many members as it has bought seats
 *  for — a plain, framework-agnostic `Error` (never a Nest `HttpException`) because this module is
 *  called from BOTH a Nest service (`invitations.service.ts`) and `lib/auth.ts`, which runs entirely
 *  outside Nest DI and needs a `better-auth` `APIError` instead — each call site translates this into
 *  whatever surface it needs, the same split `account-lifecycle.ts#SoleOwnerError`'s own header
 *  documents for the exact same reason. */
export class NoFreeSeatError extends Error {
  readonly code = NO_FREE_SEAT_CODE;

  constructor(readonly companyId: string) {
    super(`Company ${companyId} has no free seat — add one in the Polar portal.`);
    this.name = 'NoFreeSeatError';
  }
}

/** The lowest positive integer NOT already in `usedIndexes` — desk numbering starts at 1, matching how
 *  a human would number seats, never 0. */
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
 * no Polar subscription to have bought in the first place.
 */
export async function withSeatReservation<T>(
  companyId: string,
  userId: string,
  createMembership: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isBillingEnabled()) {
    return prisma.$transaction((tx) => createMembership(tx));
  }

  // Ensures the row exists to lock — a brand-new company's very first reservation (see this file's own
  // header) has no `company_subscription` row yet; `getOrCreateCompanySubscription`'s own upsert
  // already handles two concurrent first-touches safely on its own.
  await getOrCreateCompanySubscription(companyId);

  return prisma.$transaction(
    async (tx) => {
      // Row lock, held through the whole check-then-create-then-assign sequence below — see this
      // file's own header on why. `lockCompanySubscriptionRow` is the ONE place this exact lock is
      // issued (`company-subscription.store.ts`'s own header) — `seats-view.ts` takes the same lock
      // for its own seat-index bookkeeping, for the same reason.
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
    // Generous timeout — this transaction holds its lock through the caller's own membership write
    // (and, for `useInvitation`, an additional `invitationCode` update), not just this file's own
    // reads. Prisma's 5s interactive-transaction default is comfortably enough normally, but not with
    // room for a slow query queued behind a burst of coalesced calls for the same company.
    { timeout: 15_000 },
  );
}
