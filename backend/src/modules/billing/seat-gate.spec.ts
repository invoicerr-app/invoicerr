import { vi, type Mock } from 'vitest';

import { ForbiddenException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { assertUserHasSeatOrThrow, SEAT_REQUIRED_CODE } from './seat-gate';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { userCompany: { findMany: vi.fn() } },
}));
vi.mock('./company-subscription.store');

const findMany = prisma.userCompany.findMany as Mock;
const getOrCreate = getOrCreateCompanySubscription as Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

describe('assertUserHasSeatOrThrow', () => {
  afterEach(() => {
    vi.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op when billing is disabled', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await expect(assertUserHasSeatOrThrow('c1', 'u1')).resolves.toBeUndefined();
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  describe('when billing is enabled', () => {
    beforeEach(() => {
      process.env[BILLING_FLAG_NAME] = 'true';
    });

    it('resolves for a seated member', async () => {
      getOrCreate.mockResolvedValue({ seats: 2 });
      findMany.mockResolvedValue([
        { userId: 'owner', role: CompanyRole.OWNER, createdAt: new Date('2026-01-01') },
        { userId: 'u1', role: CompanyRole.MEMBER, createdAt: new Date('2026-01-02') },
      ]);

      await expect(assertUserHasSeatOrThrow('c1', 'u1')).resolves.toBeUndefined();
    });

    it('refuses, named SEAT_REQUIRED, for a member past capacity', async () => {
      getOrCreate.mockResolvedValue({ seats: 1 });
      findMany.mockResolvedValue([
        { userId: 'owner', role: CompanyRole.OWNER, createdAt: new Date('2026-01-01') },
        { userId: 'u1', role: CompanyRole.MEMBER, createdAt: new Date('2026-01-02') },
      ]);

      const action = assertUserHasSeatOrThrow('c1', 'u1');

      await expect(action).rejects.toBeInstanceOf(ForbiddenException);
      const err = await action.catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: SEAT_REQUIRED_CODE });
    });

    it('never refuses the OWNER, even at zero capacity', async () => {
      getOrCreate.mockResolvedValue({ seats: 0 });
      findMany.mockResolvedValue([
        { userId: 'owner', role: CompanyRole.OWNER, createdAt: new Date('2026-01-01') },
      ]);

      await expect(assertUserHasSeatOrThrow('c1', 'owner')).resolves.toBeUndefined();
    });

    it('lets exactly as many people write as the company bought seats, even when every member is an OWNER', async () => {
      const seats = 1;
      const members = [
        { userId: 'founder', role: CompanyRole.OWNER, createdAt: new Date('2026-01-01') },
        { userId: 'promoted-1', role: CompanyRole.OWNER, createdAt: new Date('2026-01-02') },
        { userId: 'promoted-2', role: CompanyRole.OWNER, createdAt: new Date('2026-01-03') },
        { userId: 'promoted-3', role: CompanyRole.OWNER, createdAt: new Date('2026-01-04') },
      ];
      getOrCreate.mockResolvedValue({ seats });
      findMany.mockResolvedValue(members);

      const allowedToWrite: string[] = [];
      for (const { userId } of members) {
        await assertUserHasSeatOrThrow('c1', userId).then(
          () => allowedToWrite.push(userId),
          () => undefined,
        );
      }

      // The whole point of a per-seat price: four people working must cost four seats, and promoting
      // them is not a way to buy the other three.
      expect(allowedToWrite).toEqual(['founder']);
      expect(allowedToWrite).toHaveLength(seats);
    });

    it('resolves silently for a caller with no membership row in this company at all — not what this gate exists to judge', async () => {
      getOrCreate.mockResolvedValue({ seats: 1 });
      findMany.mockResolvedValue([
        { userId: 'owner', role: CompanyRole.OWNER, createdAt: new Date('2026-01-01') },
      ]);

      // 'ghost' is not in `members` at all — this used to fall through to `memberHoldsSeat`, which
      // also returns `false` for a non-member, and come out as an indistinguishable SEAT_REQUIRED
      // refusal, contradicting this function's own documented behavior.
      await expect(assertUserHasSeatOrThrow('c1', 'ghost')).resolves.toBeUndefined();
    });
  });
});
