/**
 * The read/write core behind `Settings > Seats` — a company's own generative office plan: how many
 * seats were bought, who is seated at a numbered desk, and who is waiting for one. Pure-ish core (a
 * thin `SeatsController` is the only caller) reusing `seat-holders.ts#seatHolders` for the actual
 * seated/waiting split, so that decision stays tested in one place rather than re-derived here.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { seatHolders } from './seat-holders';

export interface SeatMemberView {
  userId: string;
  email: string;
  firstname: string;
  lastname: string;
  role: CompanyRole;
  /** `null` only for a row this call has not yet had a chance to backfill — see
   *  `ensureSeatIndexesAssigned` below; a member returned in `members` (seated) always has one by the
   *  time a response is built. */
  seatIndex: number | null;
  joinedAt: string;
}

export interface SeatsView {
  /** The bought quantity (`CompanySubscription.seats`) — read from Polar, never written to it. */
  seats: number;
  /** Seated members, ordered by desk number. */
  members: SeatMemberView[];
  /** Non-seated members, most-recently-arrived first — the queue a "Waiting for a seat" bench shows. */
  waiting: SeatMemberView[];
}

interface MemberRow {
  id: string;
  userId: string;
  role: CompanyRole;
  createdAt: Date;
  seatIndex: number | null;
  user: { email: string; firstname: string; lastname: string };
}

async function loadMembers(companyId: string): Promise<MemberRow[]> {
  return prisma.userCompany.findMany({
    where: { companyId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { email: true, firstname: true, lastname: true } } },
  });
}

/** The lowest positive integer not already in `used` — desk numbering starts at 1. */
function firstFreeIndex(used: Set<number>): number {
  let index = 1;
  while (used.has(index)) index++;
  return index;
}

/**
 * Assigns a desk to every currently-SEATED member who does not already have one WITHIN the current
 * capacity — covers a `UserCompany` row created before this column existed (every row created since
 * gets its desk at creation time, `seat-sync.ts#withSeatReservation`), and ALSO a seated member whose
 * stored `seatIndex` fell out of range because capacity shrank below it and grew back without ever
 * again exceeding it (bought seats 4 → 2, member's own desk was 3 — capacity 2 has no desk 3 to render
 * — → bought seats 4 again: that member is still "seated" by `seatHolders`'s arrival-order rule the
 * whole time, but had no valid desk number to show on the plan in the meantime; this is what actually
 * repairs it, not a data corruption). Deliberately never assigns a desk to a WAITING member: they get
 * one automatically the moment a seat frees up and this function next runs, never before.
 *
 * `used` is built ONLY from SEATED members' own valid (in-range) numbers — a WAITING member's stale
 * `seatIndex` must never block a real desk number from being handed to someone who actually needs it.
 */
export async function ensureSeatIndexesAssigned(companyId: string): Promise<void> {
  const sub = await getOrCreateCompanySubscription(companyId);
  const rows = await loadMembers(companyId);
  const { seated } = seatHolders(rows, sub.seats);

  const inRange = (index: number | null): index is number =>
    index !== null && index >= 1 && index <= sub.seats;

  const used = new Set(seated.map((row) => row.seatIndex).filter(inRange));
  const missing = seated.filter((row) => !inRange(row.seatIndex));
  if (missing.length === 0) return;

  for (const row of missing) {
    const index = firstFreeIndex(used);
    used.add(index);
    await prisma.userCompany.update({ where: { id: row.id }, data: { seatIndex: index } });
  }
}

function toView(row: MemberRow): SeatMemberView {
  return {
    userId: row.userId,
    email: row.user.email,
    firstname: row.user.firstname,
    lastname: row.user.lastname,
    role: row.role,
    seatIndex: row.seatIndex,
    joinedAt: row.createdAt.toISOString(),
  };
}

export async function getSeatsView(companyId: string): Promise<SeatsView> {
  await ensureSeatIndexesAssigned(companyId);

  const [sub, rows] = await Promise.all([getOrCreateCompanySubscription(companyId), loadMembers(companyId)]);
  const { seated, waiting } = seatHolders(rows, sub.seats);

  return {
    seats: sub.seats,
    members: seated.map(toView).sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0)),
    waiting: waiting.map(toView),
  };
}

export const SEAT_TAKEN_CODE = 'SEAT_TAKEN';

/**
 * Moves `targetUserId` to `seatIndex` — an OWNER/ADMIN re-arranging the office plan. Purely visual: a
 * desk number never grants or revokes access (`seat-holders.ts`'s own header), so this never checks
 * capacity and works exactly the same for a seated or a waiting member. Two concurrent moves onto the
 * SAME free desk are not additionally locked against each other here — the cosmetic worst case (two
 * members briefly sharing a desk number) self-heals the next time either is moved again, which is a
 * trade this file makes deliberately rather than adding a row lock for a value with no billing effect.
 */
export async function moveMemberSeat(
  companyId: string,
  targetUserId: string,
  seatIndex: number,
): Promise<SeatsView> {
  if (!Number.isInteger(seatIndex) || seatIndex < 1) {
    throw new BadRequestException('seatIndex must be a positive integer.');
  }

  const target = await prisma.userCompany.findUnique({
    where: { userId_companyId: { userId: targetUserId, companyId } },
  });
  if (!target) throw new NotFoundException('Member not found.');

  const takenBy = await prisma.userCompany.findFirst({
    where: { companyId, seatIndex, userId: { not: targetUserId } },
  });
  if (takenBy) {
    throw new ConflictException({ message: 'That desk is already taken.', code: SEAT_TAKEN_CODE });
  }

  await prisma.userCompany.update({
    where: { userId_companyId: { userId: targetUserId, companyId } },
    data: { seatIndex },
  });

  return getSeatsView(companyId);
}
