/**
 * Pure decision: given every member of a company and how many seats it has (`CompanySubscription.seats`
 * - the quantity bought through the billing provider, never something this app writes back, see
 * `seat-sync.ts`'s own header), who currently HOLDS a seat and who is left WAITING for one.
 *
 * Exists as its own tiny, dependency-free module — no Prisma import — specifically so the over-capacity
 * rule (the OWNER lowers the seat count in the billing portal below the current headcount, e.g.
 * cancelling extra seats before renewal) is one function callers can reason about and test in
 * isolation, the same "pure core, thin persistence shell" split every other sweep/decision in this
 * codebase already holds (`lifecycle.ts`, `write-gate.ts`'s own callers, …).
 *
 * `UserCompany.seatIndex` is ignored on purpose: it is a cosmetic desk position, never an access signal.
 */
import { CompanyRole } from '../../../prisma/generated/prisma/client';

export interface SeatMember {
  userId: string;
  role: CompanyRole;
  createdAt: Date;
}

export interface SeatHoldersResult<T extends SeatMember> {
  /** Never longer than `Math.max(seats, 1)`: that ceiling is the per-seat pricing promise. */
  seated: T[];
  /** Everyone past capacity, lowest-ranked first. */
  waiting: T[];
}

export function seatHolders<T extends SeatMember>(
  members: readonly T[],
  seats: number,
): SeatHoldersResult<T> {
  // `userId` breaks `createdAt` ties so the split never depends on the caller's query order.
  const byArrival = (a: T, b: T) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.userId.localeCompare(b.userId);

  const owners = members.filter((m) => m.role === CompanyRole.OWNER).sort(byArrival);
  const others = members.filter((m) => m.role !== CompanyRole.OWNER).sort(byArrival);
  const ranked = [...owners, ...others];

  // Only an owner to protect at zero capacity may lift this above the bought quantity.
  const capacity = Math.max(seats, owners.length > 0 ? 1 : 0);

  return { seated: ranked.slice(0, capacity), waiting: ranked.slice(capacity).reverse() };
}

export function memberHoldsSeat<T extends SeatMember>(
  members: readonly T[],
  seats: number,
  userId: string,
): boolean {
  return seatHolders(members, seats).seated.some((m) => m.userId === userId);
}
