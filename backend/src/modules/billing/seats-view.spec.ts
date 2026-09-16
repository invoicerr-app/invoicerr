import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { ensureSeatIndexesAssigned, getSeatsView, moveMemberSeat, SEAT_TAKEN_CODE } from './seats-view';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: {
      findMany: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));
jest.mock('./company-subscription.store');

const findMany = prisma.userCompany.findMany as jest.Mock;
const update = prisma.userCompany.update as jest.Mock;
const findUnique = prisma.userCompany.findUnique as jest.Mock;
const findFirst = prisma.userCompany.findFirst as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;

function row(
  id: string,
  userId: string,
  role: CompanyRole,
  createdAt: string,
  seatIndex: number | null,
  email = `${userId}@acme.test`,
) {
  return {
    id,
    userId,
    role,
    createdAt: new Date(createdAt),
    seatIndex,
    user: { email, firstname: userId, lastname: 'Test' },
  };
}

describe('ensureSeatIndexesAssigned', () => {
  afterEach(() => jest.resetAllMocks());

  it('does nothing when every seated member already has a desk', async () => {
    getOrCreate.mockResolvedValue({ seats: 2 });
    findMany.mockResolvedValue([row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1)]);

    await ensureSeatIndexesAssigned('c1');

    expect(update).not.toHaveBeenCalled();
  });

  it('backfills a desk for a seated member with none, filling the lowest free number', async () => {
    getOrCreate.mockResolvedValue({ seats: 3 });
    findMany.mockResolvedValue([
      row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 2),
      row('r2', 'm1', CompanyRole.MEMBER, '2026-01-02', null),
    ]);

    await ensureSeatIndexesAssigned('c1');

    expect(update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { seatIndex: 1 } });
  });

  it('never assigns a desk to a WAITING (over-capacity) member', async () => {
    getOrCreate.mockResolvedValue({ seats: 1 });
    findMany.mockResolvedValue([
      row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
      row('r2', 'm1', CompanyRole.MEMBER, '2026-01-02', null),
    ]);

    await ensureSeatIndexesAssigned('c1');

    expect(update).not.toHaveBeenCalled();
  });

  it('repairs a SEATED member whose stored desk number fell out of range when capacity shrank', async () => {
    // Capacity shrank from 4 to 2 while this member's desk was 3, then grew back — never past 3
    // again in this scenario, so the member is still "seated" by arrival order the whole time, but
    // desk 3 does not exist in a 2-desk plan. Desk 2 is free (nobody else claims it).
    getOrCreate.mockResolvedValue({ seats: 2 });
    findMany.mockResolvedValue([
      row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
      row('r2', 'early', CompanyRole.MEMBER, '2026-01-02', 3),
    ]);

    await ensureSeatIndexesAssigned('c1');

    expect(update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { seatIndex: 2 } });
  });

  it("never lets a WAITING member's own stale seatIndex block a real desk from being repaired", async () => {
    // 'late' is WAITING (arrived after capacity ran out) but still carries the desk number (2) they
    // held before capacity shrank. 'early' is SEATED but its own number (3) is out of range — it must
    // be repaired to the genuinely free desk 2, `late`'s merely-stale number must not reserve it.
    getOrCreate.mockResolvedValue({ seats: 2 });
    findMany.mockResolvedValue([
      row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
      row('r2', 'early', CompanyRole.MEMBER, '2026-01-02', 3),
      row('r3', 'late', CompanyRole.MEMBER, '2026-01-03', 2),
    ]);

    await ensureSeatIndexesAssigned('c1');

    expect(update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { seatIndex: 2 } });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('getSeatsView', () => {
  afterEach(() => jest.resetAllMocks());

  it('splits members into seated (by desk order) and waiting (newest first)', async () => {
    getOrCreate.mockResolvedValue({ seats: 2 });
    findMany.mockResolvedValue([
      row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
      row('r2', 'early', CompanyRole.MEMBER, '2026-01-02', 2),
      row('r3', 'late', CompanyRole.MEMBER, '2026-01-03', 3),
    ]);

    const view = await getSeatsView('c1');

    expect(view.seats).toBe(2);
    expect(view.members.map((m) => m.userId)).toEqual(['owner', 'early']);
    expect(view.waiting.map((m) => m.userId)).toEqual(['late']);
  });
});

describe('moveMemberSeat', () => {
  afterEach(() => jest.resetAllMocks());

  it('refuses a non-positive-integer seatIndex', async () => {
    await expect(moveMemberSeat('c1', 'u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(moveMemberSeat('c1', 'u1', 1.5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for a target user not in the company', async () => {
    findUnique.mockResolvedValue(null);
    await expect(moveMemberSeat('c1', 'ghost', 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses, named SEAT_TAKEN, when the desk is already occupied by someone else', async () => {
    findUnique.mockResolvedValue({ id: 'r1', userId: 'u1' });
    findFirst.mockResolvedValue({ id: 'r2', userId: 'other' });

    const action = moveMemberSeat('c1', 'u1', 2);

    await expect(action).rejects.toBeInstanceOf(ConflictException);
    const err = await action.catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: SEAT_TAKEN_CODE });
    expect(update).not.toHaveBeenCalled();
  });

  it('moves the member and returns the refreshed view', async () => {
    findUnique.mockResolvedValue({ id: 'r1', userId: 'u1' });
    findFirst.mockResolvedValue(null);
    update.mockResolvedValue({});
    getOrCreate.mockResolvedValue({ seats: 2 });
    findMany.mockResolvedValue([row('r1', 'u1', CompanyRole.MEMBER, '2026-01-01', 3)]);

    const view = await moveMemberSeat('c1', 'u1', 3);

    expect(update).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'u1', companyId: 'c1' } },
      data: { seatIndex: 3 },
    });
    expect(view.members[0]).toMatchObject({ userId: 'u1', seatIndex: 3 });
  });
});
