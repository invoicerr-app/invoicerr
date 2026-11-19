/** Backs `Settings > Seats`: bought seats, members at numbered desks, and the waiting queue. */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompanyRole, Prisma } from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription, lockCompanySubscriptionRow } from './company-subscription.store';
import { seatHolders } from './seat-holders';

export interface SeatMemberView {
  userId: string;
  email: string;
  firstname: string;
  lastname: string;
  role: CompanyRole;
  /** `null` only before `ensureSeatIndexesAssigned` backfills it; seated members always have one. */
  seatIndex: number | null;
  joinedAt: string;
}

export interface SeatsView {
  /** The bought quantity (`CompanySubscription.seats`) - a fact read here, never written. */
  seats: number;
  /** Seated members, ordered by desk number. */
  members: SeatMemberView[];
  /** Non-seated members, most recently arrived first. */
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

/** Accepts both the `prisma` singleton and a transaction client, which it structurally satisfies. */
async function loadMembers(client: Prisma.TransactionClient, companyId: string): Promise<MemberRow[]> {
  return client.userCompany.findMany({
    where: { companyId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { email: true, firstname: true, lastname: true } } },
  });
}

/** Desk numbering starts at 1. */
function firstFreeIndex(used: Set<number>): number {
  let index = 1;
  while (used.has(index)) index++;
  return index;
}

/**
 * Gives every seated member without an in-range desk the first free one (capacity can shrink below a
 * stored desk and grow back). Waiting members' stale indexes never block a desk. Runs under the same
 * row lock as `withSeatReservation` so concurrent calls cannot hand out the same desk twice.
 */
export async function ensureSeatIndexesAssigned(companyId: string): Promise<void> {
  await getOrCreateCompanySubscription(companyId); // the row must exist before it can be locked

  await prisma.$transaction(async (tx) => {
    await lockCompanySubscriptionRow(tx, companyId);

    const sub = await tx.companySubscription.findUniqueOrThrow({ where: { companyId } });
    const rows = await loadMembers(tx, companyId);
    const { seated } = seatHolders(rows, sub.seats);

    const inRange = (index: number | null): index is number =>
      index !== null && index >= 1 && index <= sub.seats;

    const used = new Set(seated.map((row) => row.seatIndex).filter(inRange));
    const missing = seated.filter((row) => !inRange(row.seatIndex));
    if (missing.length === 0) return;

    for (const row of missing) {
      const index = firstFreeIndex(used);
      used.add(index);
      await tx.userCompany.update({ where: { id: row.id }, data: { seatIndex: index } });
    }
  });
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

  const [sub, rows] = await Promise.all([
    getOrCreateCompanySubscription(companyId),
    loadMembers(prisma, companyId),
  ]);
  const { seated, waiting } = seatHolders(rows, sub.seats);

  return {
    seats: sub.seats,
    members: seated.map(toView).sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0)),
    waiting: waiting.map(toView),
  };
}

export const SEAT_TAKEN_CODE = 'SEAT_TAKEN';

/**
 * Purely visual: a desk number never grants or revokes access, so seated and waiting members are
 * treated alike. Out-of-range desks are refused, since `ensureSeatIndexesAssigned` would otherwise
 * silently reassign them. Runs under the subscription row lock so two moves cannot share one desk.
 */
export async function moveMemberSeat(
  companyId: string,
  targetUserId: string,
  seatIndex: number,
): Promise<SeatsView> {
  if (!Number.isInteger(seatIndex) || seatIndex < 1) {
    throw new BadRequestException('seatIndex must be a positive integer.');
  }

  await getOrCreateCompanySubscription(companyId); // the row must exist before it can be locked

  await prisma.$transaction(async (tx) => {
    await lockCompanySubscriptionRow(tx, companyId);

    const sub = await tx.companySubscription.findUniqueOrThrow({ where: { companyId } });
    if (seatIndex > sub.seats) {
      throw new BadRequestException(
        `seatIndex must be between 1 and ${sub.seats} (this company's own bought seat count).`,
      );
    }

    const target = await tx.userCompany.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!target) throw new NotFoundException('Member not found.');

    const takenBy = await tx.userCompany.findFirst({
      where: { companyId, seatIndex, userId: { not: targetUserId } },
    });
    if (takenBy) {
      throw new ConflictException({ message: 'That desk is already taken.', code: SEAT_TAKEN_CODE });
    }

    await tx.userCompany.update({
      where: { userId_companyId: { userId: targetUserId, companyId } },
      data: { seatIndex },
    });
  });

  return getSeatsView(companyId);
}
