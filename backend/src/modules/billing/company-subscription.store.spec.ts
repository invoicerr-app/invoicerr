import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import {
  findCompanySubscription,
  getOrCreateCompanySubscription,
  listAdvanceableCompanySubscriptions,
  recomputeStatusForVanishedSubscription,
  releaseCheckoutWindow,
  reserveCheckoutWindow,
} from './company-subscription.store';
import { addDays, BLOCKED_DAYS, computeTrialWindow, TRIAL_DAYS } from './lifecycle';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySubscription: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const findUnique = prisma.companySubscription.findUnique as Mock;
const upsert = prisma.companySubscription.upsert as Mock;
const findMany = prisma.companySubscription.findMany as Mock;
const update = prisma.companySubscription.update as Mock;
const updateMany = prisma.companySubscription.updateMany as Mock;

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

describe('recomputeStatusForVanishedSubscription', () => {
  afterEach(() => vi.resetAllMocks());

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

describe('reserveCheckoutWindow', () => {
  afterEach(() => vi.resetAllMocks());

  const NOW = new Date('2026-09-17T12:00:00.000Z');
  const WINDOW_MS = 10 * 60 * 1000;

  it('claims the window with a single conditional updateMany, matching a null or stale lastCheckoutStartedAt', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    const result = await reserveCheckoutWindow('company-1', WINDOW_MS, NOW);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        OR: [
          { lastCheckoutStartedAt: null },
          { lastCheckoutStartedAt: { lt: new Date(NOW.getTime() - WINDOW_MS) } },
        ],
      },
      data: { lastCheckoutStartedAt: NOW },
    });
    expect(result).toEqual(NOW);
  });

  it('returns null (claims nothing) when the conditional write matches no row — the window is already held', async () => {
    // This is the race this function exists to close: two callers both call `updateMany` with the same
    // WHERE clause against the same row. Postgres serializes the two UPDATEs, so only the first can
    // still see the row as eligible; the second's WHERE clause is now false and its `count` is 0 — it
    // must NOT fall back to a separate read that could observe the first caller's own fresh write.
    updateMany.mockResolvedValue({ count: 0 });

    const result = await reserveCheckoutWindow('company-1', WINDOW_MS, NOW);

    expect(result).toBeNull();
  });
});

describe('releaseCheckoutWindow', () => {
  afterEach(() => vi.resetAllMocks());

  it('clears lastCheckoutStartedAt, matched by the exact timestamp this call reserved', async () => {
    const reservedAt = new Date('2026-09-17T12:00:00.000Z');
    updateMany.mockResolvedValue({ count: 1 });

    await releaseCheckoutWindow('company-1', reservedAt);

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', lastCheckoutStartedAt: reservedAt },
      data: { lastCheckoutStartedAt: null },
    });
  });
});
