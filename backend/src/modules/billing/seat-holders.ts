/**
 * Pure decision: given every member of a company and how many seats it has (`CompanySubscription.seats`
 * — the quantity bought in the Polar portal, never something this app writes to Polar, see
 * `seat-sync.ts`'s own header), who currently HOLDS a seat and who is left WAITING for one.
 *
 * Exists as its own tiny, dependency-free module — no Prisma import — specifically so the over-capacity
 * rule (the OWNER lowers the seat count in the Polar portal below the current headcount, e.g.
 * cancelling extra seats before renewal) is one function callers can reason about and test in
 * isolation, the same "pure core, thin persistence shell" split every other sweep/decision in this
 * codebase already holds (`lifecycle.ts`, `write-gate.ts`'s own callers, …).
 *
 * ## The rule, in order
 *  1. Every `OWNER` always holds a seat, unconditionally — the most recently arrived members wait for a
 *     seat, never the OWNER — even in the degenerate case of more owners than seats (a company can have
 *     several `OWNER` rows — `assertNotLastOwner` only forbids removing the LAST one). This can make the
 *     seated count exceed `seats`; that is intentional, not a bug to fix
 *     here — a business rule ("never lock out the owner") outranking a raw capacity number.
 *  2. Every other member keeps their seat in ARRIVAL order (`createdAt` ascending) — the earliest
 *     joiners fill the remaining capacity first.
 *  3. Whoever is left once capacity runs out WAITS — returned newest-first (`createdAt` descending),
 *     since that reads naturally as "the queue", the front of which is who just lost access.
 *
 * Deliberately ignores `UserCompany.seatIndex` entirely: that column is a cosmetic desk POSITION on the
 * generative office plan (`seats-view.ts`), never a capacity or access signal — moving someone to a
 * different (free) desk must never grant or revoke their access, and losing access on a capacity drop
 * must never silently reassign or clear their desk (they get it back the moment a seat frees up or is
 * bought back, `seats-view.ts#getSeatsView`'s own header).
 */
import { CompanyRole } from '../../../prisma/generated/prisma/client';

export interface SeatMember {
  userId: string;
  role: CompanyRole;
  createdAt: Date;
}

export interface SeatHoldersResult<T extends SeatMember> {
  /** Owners first (in whatever order they were given — see this file's own header on why an owner
   *  never has to compete for a slot), then the earliest-arrived non-owners, up to capacity. */
  seated: T[];
  /** Non-owners past capacity, most-recently-arrived first. Empty whenever `seats` covers everyone. */
  waiting: T[];
}

export function seatHolders<T extends SeatMember>(
  members: readonly T[],
  seats: number,
): SeatHoldersResult<T> {
  const owners = members.filter((m) => m.role === CompanyRole.OWNER);
  const nonOwners = members
    .filter((m) => m.role !== CompanyRole.OWNER)
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Never negative — an owner headcount alone already at or past `seats` simply leaves zero remaining
  // capacity for anyone else, rather than a nonsensical negative `slice` count.
  const remainingCapacity = Math.max(seats - owners.length, 0);

  return {
    seated: [...owners, ...nonOwners.slice(0, remainingCapacity)],
    waiting: nonOwners.slice(remainingCapacity).reverse(),
  };
}

/** `true` when `userId` is among `members` currently holding a seat — the one check
 *  `seat-gate.ts`/`(app)/_layout.tsx`'s waiting screen actually need, without either having to re-derive
 *  the full seated/waiting split themselves. */
export function memberHoldsSeat<T extends SeatMember>(
  members: readonly T[],
  seats: number,
  userId: string,
): boolean {
  return seatHolders(members, seats).seated.some((m) => m.userId === userId);
}
