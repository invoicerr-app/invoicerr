import prisma from '@/prisma/prisma.service';

import {
  getOrCreateCompanySubscription,
  listAdvanceableCompanySubscriptions,
  recomputeStatusForVanishedSubscription,
} from './company-subscription.store';
import { addDays, BLOCKED_DAYS, computeTrialWindow, TRIAL_DAYS } from './lifecycle';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const findUnique = prisma.companySubscription.findUnique as jest.Mock;
const upsert = prisma.companySubscription.upsert as jest.Mock;
const findMany = prisma.companySubscription.findMany as jest.Mock;
const update = prisma.companySubscription.update as jest.Mock;

describe('getOrCreateCompanySubscription', () => {
  afterEach(() => jest.resetAllMocks());

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

describe('listAdvanceableCompanySubscriptions', () => {
  afterEach(() => jest.resetAllMocks());

  it('excludes DELETED rows', async () => {
    findMany.mockResolvedValue([]);
    await listAdvanceableCompanySubscriptions();
    expect(findMany).toHaveBeenCalledWith({ where: { status: { not: 'DELETED' } } });
  });
});

describe('recomputeStatusForVanishedSubscription', () => {
  afterEach(() => jest.resetAllMocks());

  const T0 = new Date('2026-09-15T00:00:00.000Z');

  it('writes PAST_DUE, clears interval/seatPaymentFailedAt, stamps lastPolarFactAt to the anchor', async () => {
    const trialEndsAt = addDays(T0, -60); // long over
    const anchor = addDays(T0, -1);
    const updated = { companyId: 'company-1', status: 'PAST_DUE' };
    update.mockResolvedValue(updated);

    const result = await recomputeStatusForVanishedSubscription('company-1', trialEndsAt, anchor, T0);

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: {
        status: 'PAST_DUE',
        blockedAt: null,
        interval: null,
        seatPaymentFailedAt: null,
        lastPolarFactAt: anchor,
      },
    });
    expect(result).toBe(updated);
  });

  it('writes BLOCKED with blockedAt BACKDATED to the anchor once BLOCKED_DAYS elapsed since it', async () => {
    const trialEndsAt = addDays(T0, -60);
    const anchor = addDays(T0, -BLOCKED_DAYS);
    update.mockResolvedValue({ companyId: 'company-1', status: 'BLOCKED' });

    await recomputeStatusForVanishedSubscription('company-1', trialEndsAt, anchor, T0);

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: expect.objectContaining({ status: 'BLOCKED', blockedAt: anchor }),
    });
  });

  it('writes TRIAL when the original trial window has not ended yet', async () => {
    const trialEndsAt = addDays(T0, TRIAL_DAYS);
    update.mockResolvedValue({ companyId: 'company-1', status: 'TRIAL' });

    await recomputeStatusForVanishedSubscription('company-1', trialEndsAt, T0, T0);

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: expect.objectContaining({ status: 'TRIAL', blockedAt: null }),
    });
  });

  it("never touches polarSubscriptionId or seats — see this function's own header", async () => {
    update.mockResolvedValue({ companyId: 'company-1', status: 'PAST_DUE' });

    await recomputeStatusForVanishedSubscription('company-1', addDays(T0, -60), addDays(T0, -1), T0);

    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('polarSubscriptionId');
    expect(data).not.toHaveProperty('seats');
  });
});
