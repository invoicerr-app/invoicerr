import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import {
  findCompanySubscription,
  getOrCreateCompanySubscription,
  listAdvanceableCompanySubscriptions,
} from './company-subscription.store';
import { computeTrialWindow } from './lifecycle';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const findUnique = prisma.companySubscription.findUnique as Mock;
const upsert = prisma.companySubscription.upsert as Mock;
const findMany = prisma.companySubscription.findMany as Mock;

describe('getOrCreateCompanySubscription', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns the existing row without ever calling upsert', async () => {
    const existing = { id: 'sub-1', companyId: 'company-1', status: 'ACTIVE' };
    findUnique.mockResolvedValue(existing);

    const result = await getOrCreateCompanySubscription('company-1');

    expect(result).toBe(existing);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('lazily creates a fresh 14-day TRIAL window, starting at `now`, when none exists', async () => {
    findUnique.mockResolvedValue(null);
    const now = new Date('2026-09-15T12:00:00.000Z');
    const created = { id: 'sub-1', companyId: 'company-1', status: 'TRIAL' };
    upsert.mockResolvedValue(created);

    const result = await getOrCreateCompanySubscription('company-1', now);

    const { trialStartedAt, trialEndsAt } = computeTrialWindow(now);
    expect(upsert).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      create: { companyId: 'company-1', trialStartedAt, trialEndsAt },
      update: {},
    });
    expect(result).toBe(created);
  });
});

describe('findCompanySubscription', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns the row as-is, never creating one', async () => {
    const existing = { id: 'sub-1', companyId: 'company-1', status: 'ACTIVE' };
    findUnique.mockResolvedValue(existing);

    const result = await findCompanySubscription('company-1');

    expect(result).toBe(existing);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns null for a Company with no row at all, without creating one', async () => {
    findUnique.mockResolvedValue(null);

    const result = await findCompanySubscription('company-1');

    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('listAdvanceableCompanySubscriptions', () => {
  afterEach(() => vi.resetAllMocks());

  it('excludes DELETED rows', async () => {
    findMany.mockResolvedValue([]);
    await listAdvanceableCompanySubscriptions();
    expect(findMany).toHaveBeenCalledWith({ where: { status: { not: 'DELETED' } } });
  });
});
