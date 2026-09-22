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
 * ## What a seat IS, and therefore what this function may never do
 * A seat is ONE USER ACCOUNT attached to the company, and the owner counts as one from the moment the
 * company is created (Terms of Service, Section 6.2) — the same role-blind definition
 * `seat-sync.ts#withSeatReservation` already enforces when a NEW membership is created: it refuses the
 * arrival once headcount would exceed the bought quantity, whatever role the arriving member holds. So
 * the number of people who can work must never exceed the number of seats the company pays for, with
 * exactly the one bounded exception spelled out in rule 3.
 *
 * ## The rule, in order
 *  1. Members are RANKED: the `OWNER`s first, in arrival order (`createdAt` ascending), then every other
 *     member in arrival order. A role is a PRIORITY over the seats the company bought, never an
 *     exemption from buying one — whoever ranks past capacity waits, owner or not.
 *  2. Capacity is `seats`, the bought quantity: `seated` is the first `seats` ranked members and no
 *     more. An `OWNER` past that line waits exactly like anyone else. Seating every `OWNER`
 *     unconditionally — which is what this function used to do — made the bought quantity mean nothing:
 *     a company can hold any number of `OWNER` rows (`assertNotLastOwner` only forbids removing the
 *     LAST one) and promoting a member costs nothing and changes no seat count, so one seat plus one
 *     `PATCH` per colleague seated an entire company for the price of a single seat.
 *  3. ONE bounded exception, the business rule the unconditional version was reaching for: the
 *     longest-standing `OWNER` keeps a seat even when capacity is zero, so a company that has dropped
 *     to zero seats still has exactly one person who can log in and buy some back. One person, never N:
 *     that is the difference between "never lock the owner out of their own billing" and "role-based
 *     free seats".
 *  4. Whoever is left once capacity runs out WAITS — returned in REVERSE rank order, since that reads
 *     naturally as "the queue": its front is whoever just lost access (the lowest-ranked member, i.e.
 *     the most recently arrived non-owner in the ordinary single-owner company) and its back is whoever
 *     takes the next seat that frees up.
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
  /** Owners first (in arrival order), then the earliest-arrived other members — capped at the bought
   *  `seats`, except for the single longest-standing owner of rule 3. Never longer than
   *  `Math.max(seats, 1)`: that ceiling IS the per-seat pricing promise, see this file's own header. */
  seated: T[];
  /** Everyone past capacity, lowest-ranked first. Empty whenever `seats` covers the whole company. */
  waiting: T[];
}

export function seatHolders<T extends SeatMember>(
  members: readonly T[],
  seats: number,
): SeatHoldersResult<T> {
  // `userId` breaks a `createdAt` tie (two memberships written in the same millisecond) so the split is
  // a function of the members alone — never of the order the caller's own query happened to return
  // them in, which would let the same company answer "you hold a seat" and "you do not" to two
  // identical requests.
  const byArrival = (a: T, b: T) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.userId.localeCompare(b.userId);

  const owners = members.filter((m) => m.role === CompanyRole.OWNER).sort(byArrival);
  const others = members.filter((m) => m.role !== CompanyRole.OWNER).sort(byArrival);
  const ranked = [...owners, ...others];

  // Never negative, and never above the bought quantity (rule 2) — the one thing that may push it to 1
  // is a company that still has an owner to protect at zero capacity (rule 3).
  const capacity = Math.max(seats, owners.length > 0 ? 1 : 0);

  return { seated: ranked.slice(0, capacity), waiting: ranked.slice(capacity).reverse() };
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
