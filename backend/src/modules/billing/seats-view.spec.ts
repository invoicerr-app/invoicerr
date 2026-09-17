import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription, lockCompanySubscriptionRow } from './company-subscription.store';
import { ensureSeatIndexesAssigned, getSeatsView, moveMemberSeat, SEAT_TAKEN_CODE } from './seats-view';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
jest.mock('./company-subscription.store');

const findMany = prisma.userCompany.findMany as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const lockRow = lockCompanySubscriptionRow as jest.Mock;

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

/** A fake interactive-transaction client — every model delegate `ensureSeatIndexesAssigned`/
 *  `moveMemberSeat` touch INSIDE `prisma.$transaction`, the same "narrow, hand-rolled fake" convention
 *  `seat-sync.spec.ts` already uses for its own (sibling) transaction. Reused across every
 *  `prisma.$transaction` call a single test triggers (`moveMemberSeat` opens its own, then a SECOND one
 *  via its own call to `getSeatsView` → `ensureSeatIndexesAssigned`) — real Prisma would hand out a
 *  fresh client per call, but since these run strictly sequentially in every scenario here, one shared
 *  fake with mutable mock state is enough to exercise both. */
function fakeTx(
  overrides: {
    sub?: { seats: number };
    rows?: ReturnType<typeof row>[];
    findUniqueMember?: unknown;
    findFirstMember?: unknown;
  } = {},
) {
  return {
    companySubscription: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(overrides.sub ?? { seats: 1 }),
    },
    userCompany: {
      findMany: jest.fn().mockResolvedValue(overrides.rows ?? []),
      findUnique: jest.fn().mockResolvedValue(overrides.findUniqueMember ?? null),
      findFirst: jest.fn().mockResolvedValue(overrides.findFirstMember ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

/** Wires `prisma.$transaction` to actually invoke its callback against a fresh `fakeTx` — returns the
 *  `tx` so a test can assert against its own mocks. */
function stubTransaction(overrides: Parameters<typeof fakeTx>[0] = {}) {
  const tx = fakeTx(overrides);
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
  return tx;
}

describe('ensureSeatIndexesAssigned', () => {
  afterEach(() => jest.resetAllMocks());

  it('does nothing when every seated member already has a desk', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 2 },
      rows: [row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1)],
    });

    await ensureSeatIndexesAssigned('c1');

    expect(tx.userCompany.update).not.toHaveBeenCalled();
  });

  it('holds the shared company_subscription row lock for the whole read-then-assign sequence', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 2 }, rows: [] });

    await ensureSeatIndexesAssigned('c1');

    expect(lockRow).toHaveBeenCalledWith(tx, 'c1');
  });

  it('backfills a desk for a seated member with none, filling the lowest free number', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 3 },
      rows: [
        row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 2),
        row('r2', 'm1', CompanyRole.MEMBER, '2026-01-02', null),
      ],
    });

    await ensureSeatIndexesAssigned('c1');

    expect(tx.userCompany.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { seatIndex: 1 } });
  });

  it('never assigns a desk to a WAITING (over-capacity) member', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 1 },
      rows: [
        row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
        row('r2', 'm1', CompanyRole.MEMBER, '2026-01-02', null),
      ],
    });

    await ensureSeatIndexesAssigned('c1');

    expect(tx.userCompany.update).not.toHaveBeenCalled();
  });

  it('repairs a SEATED member whose stored desk number fell out of range when capacity shrank', async () => {
    // Capacity shrank from 4 to 2 while this member's desk was 3, then grew back — never past 3
    // again in this scenario, so the member is still "seated" by arrival order the whole time, but
    // desk 3 does not exist in a 2-desk plan. Desk 2 is free (nobody else claims it).
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 2 },
      rows: [
        row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
        row('r2', 'early', CompanyRole.MEMBER, '2026-01-02', 3),
      ],
    });

    await ensureSeatIndexesAssigned('c1');

    expect(tx.userCompany.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { seatIndex: 2 } });
  });

  it("never lets a WAITING member's own stale seatIndex block a real desk from being repaired", async () => {
    // 'late' is WAITING (arrived after capacity ran out) but still carries the desk number (2) they
    // held before capacity shrank. 'early' is SEATED but its own number (3) is out of range — it must
    // be repaired to the genuinely free desk 2, `late`'s merely-stale number must not reserve it.
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 2 },
      rows: [
        row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
        row('r2', 'early', CompanyRole.MEMBER, '2026-01-02', 3),
        row('r3', 'late', CompanyRole.MEMBER, '2026-01-03', 2),
      ],
    });

    await ensureSeatIndexesAssigned('c1');

    expect(tx.userCompany.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { seatIndex: 2 } });
    expect(tx.userCompany.update).toHaveBeenCalledTimes(1);
  });

  it(
    'acquires the row lock BEFORE reading members/capacity, inside the SAME transaction — the exact ' +
      'ordering a `SELECT … FOR UPDATE` needs to actually serialize two concurrent callers against ' +
      'each other, rather than each computing `used` from its own stale, unlocked read',
    async () => {
      getOrCreate.mockResolvedValue({});
      const tx = stubTransaction({
        sub: { seats: 3 },
        rows: [row('r1', 'm1', CompanyRole.MEMBER, '2026-01-02', null)],
      });

      await ensureSeatIndexesAssigned('c1');

      const lockedAt = lockRow.mock.invocationCallOrder[0];
      const readSubAt = tx.companySubscription.findUniqueOrThrow.mock.invocationCallOrder[0];
      const readMembersAt = tx.userCompany.findMany.mock.invocationCallOrder[0];
      expect(lockedAt).toBeLessThan(readSubAt);
      expect(lockedAt).toBeLessThan(readMembersAt);
      // And both reads — and the write they lead to — happen against the SAME locked `tx`, never a
      // separate, unlocked `prisma` call that would defeat the lock entirely.
      expect(lockRow).toHaveBeenCalledWith(tx, 'c1');
    },
  );
});

describe('getSeatsView', () => {
  afterEach(() => jest.resetAllMocks());

  it('splits members into seated (by desk order) and waiting (newest first)', async () => {
    getOrCreate.mockResolvedValue({ seats: 2 });
    const rows = [
      row('r1', 'owner', CompanyRole.OWNER, '2026-01-01', 1),
      row('r2', 'early', CompanyRole.MEMBER, '2026-01-02', 2),
      row('r3', 'late', CompanyRole.MEMBER, '2026-01-03', 3),
    ];
    stubTransaction({ sub: { seats: 2 }, rows });
    findMany.mockResolvedValue(rows);

    const view = await getSeatsView('c1');

    expect(view.seats).toBe(2);
    expect(view.members.map((m) => m.userId)).toEqual(['owner', 'early']);
    expect(view.waiting.map((m) => m.userId)).toEqual(['late']);
  });
});

describe('moveMemberSeat', () => {
  afterEach(() => jest.resetAllMocks());

  it('refuses a non-positive-integer seatIndex without ever opening a transaction', async () => {
    await expect(moveMemberSeat('c1', 'u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(moveMemberSeat('c1', 'u1', 1.5)).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a seatIndex beyond the company's own bought seat count, named and explicit (never silently reassigned)", async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 2 } });

    const action = moveMemberSeat('c1', 'u1', 3);

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action.catch((e) => e.message)).resolves.toContain('between 1 and 2');
  });

  it('404s for a target user not in the company', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 5 }, findUniqueMember: null });

    await expect(moveMemberSeat('c1', 'ghost', 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses, named SEAT_TAKEN, when the desk is already occupied by someone else', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 5 },
      findUniqueMember: { id: 'r1', userId: 'u1' },
      findFirstMember: { id: 'r2', userId: 'other' },
    });

    const action = moveMemberSeat('c1', 'u1', 2);

    await expect(action).rejects.toBeInstanceOf(ConflictException);
    const err = await action.catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: SEAT_TAKEN_CODE });
    expect(tx.userCompany.update).not.toHaveBeenCalled();
  });

  it('moves the member (inside the locked transaction) and returns the refreshed view', async () => {
    getOrCreate.mockResolvedValue({ seats: 3 });
    const rows = [row('r1', 'u1', CompanyRole.MEMBER, '2026-01-01', 3)];
    const tx = stubTransaction({
      sub: { seats: 3 },
      rows,
      findUniqueMember: { id: 'r1', userId: 'u1' },
      findFirstMember: null,
    });
    findMany.mockResolvedValue(rows);

    const view = await moveMemberSeat('c1', 'u1', 3);

    expect(lockRow).toHaveBeenCalledWith(tx, 'c1');
    expect(tx.userCompany.update).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'u1', companyId: 'c1' } },
      data: { seatIndex: 3 },
    });
    expect(view.members[0]).toMatchObject({ userId: 'u1', seatIndex: 3 });
  });
});
