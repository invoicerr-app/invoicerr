/**
 * Splits a company's members into who holds a seat and who waits, given the seat count bought in Polar.
 *
 * Owners rank first, then everyone by arrival. Capacity is the bought `seats`, owners included: a company
 * can have any number of `OWNER` rows and promotion is free, so seating all owners would make the seat
 * count meaningless. The one exception is the longest-standing owner, who keeps a seat at zero capacity so
 * someone can still buy seats back. `waiting` is in reverse rank order (front = whoever just lost access).
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
