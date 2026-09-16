import { ForbiddenException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { assertUserHasSeatOrThrow, SEAT_REQUIRED_CODE } from './seat-gate';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { userCompany: { findMany: jest.fn() } },
}));
jest.mock('./company-subscription.store');

const findMany = prisma.userCompany.findMany as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

describe('assertUserHasSeatOrThrow', () => {
  afterEach(() => {
    jest.resetAllMocks();
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
  });
});
