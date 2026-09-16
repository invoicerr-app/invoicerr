import prisma from '@/prisma/prisma.service';

import { reconcileCompanySeats, SeatReconcileClient } from './seat-reconcile';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { companySubscription: { update: jest.fn() } },
}));
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const update = prisma.companySubscription.update as jest.Mock;

function fakeClient(get: jest.Mock): SeatReconcileClient {
  return { subscriptions: { get } };
}

describe('reconcileCompanySeats', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns null and never calls Polar when the company has no polarSubscriptionId yet', async () => {
    const get = jest.fn();
    const client = fakeClient(get);

    const result = await reconcileCompanySeats(
      { companyId: 'c1', polarSubscriptionId: null, seats: 1 },
      client,
    );

    expect(result).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('does nothing when the counts already match', async () => {
    const get = jest.fn().mockResolvedValue({ seats: 3 });
    const client = fakeClient(get);

    const result = await reconcileCompanySeats(
      { companyId: 'c1', polarSubscriptionId: 'sub_1', seats: 3 },
      client,
    );

    expect(result).toEqual({ corrected: false, localSeats: 3, polarSeats: 3 });
    expect(update).not.toHaveBeenCalled();
  });

  it('overwrites the LOCAL row with what Polar reports when they differ — never the reverse', async () => {
    const get = jest.fn().mockResolvedValue({ seats: 7 });
    const client = fakeClient(get);

    const result = await reconcileCompanySeats(
      { companyId: 'c1', polarSubscriptionId: 'sub_1', seats: 2 },
      client,
    );

    expect(update).toHaveBeenCalledWith({ where: { companyId: 'c1' }, data: { seats: 7 } });
    expect(result).toEqual({ corrected: true, localSeats: 7, polarSeats: 7 });
  });

  it('never writes anything to Polar — this client type has no update() at all', () => {
    // Purely a type-level guarantee: `SeatReconcileClient` declares only `subscriptions.get`. Asserted
    // here as a runtime fact too — the fake above never defines `update`, and the function above never
    // calls it.
    const client = fakeClient(jest.fn().mockResolvedValue({ seats: 1 }));
    expect((client.subscriptions as unknown as { update?: unknown }).update).toBeUndefined();
  });

  it('a null/undefined seats on the Polar response is left uncorrected, never written as 0', async () => {
    const get = jest.fn().mockResolvedValue({ seats: null });
    const client = fakeClient(get);

    const result = await reconcileCompanySeats(
      { companyId: 'c1', polarSubscriptionId: 'sub_1', seats: 4 },
      client,
    );

    expect(result).toEqual({ corrected: false, localSeats: 4, polarSeats: null });
    expect(update).not.toHaveBeenCalled();
  });

  it('propagates a Polar failure to its caller (the sweep runner decides how to isolate it)', async () => {
    const get = jest.fn().mockRejectedValue(new Error('polar unreachable'));
    const client = fakeClient(get);

    await expect(
      reconcileCompanySeats({ companyId: 'c1', polarSubscriptionId: 'sub_1', seats: 3 }, client),
    ).rejects.toThrow('polar unreachable');
  });
});
