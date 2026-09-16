import prisma from '@/prisma/prisma.service';

import { countCompanySeats } from './seat-sync';
import { reconcileCompanySeats, SeatReconcileClient } from './seat-reconcile';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { companySubscription: { update: jest.fn() } },
}));
jest.mock('./seat-sync');
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const update = prisma.companySubscription.update as jest.Mock;
const countSeats = countCompanySeats as jest.Mock;

function fakeClient(get: jest.Mock, updateSub: jest.Mock = jest.fn()): SeatReconcileClient {
  return { subscriptions: { get, update: updateSub } };
}

describe('reconcileCompanySeats', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns null and never calls Polar when the company has no polarSubscriptionId yet', async () => {
    const get = jest.fn();
    const client = fakeClient(get);

    const result = await reconcileCompanySeats({ companyId: 'c1', polarSubscriptionId: null }, client);

    expect(result).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(countSeats).not.toHaveBeenCalled();
  });

  it('does nothing when the counts already match', async () => {
    countSeats.mockResolvedValue(3);
    const get = jest.fn().mockResolvedValue({ seats: 3 });
    const updateSub = jest.fn();
    const client = fakeClient(get, updateSub);

    const result = await reconcileCompanySeats({ companyId: 'c1', polarSubscriptionId: 'sub_1' }, client);

    expect(result).toEqual({ corrected: false, localSeats: 3, polarSeats: 3 });
    expect(updateSub).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('pushes a correction to Polar and to the local row when the DB count is higher', async () => {
    countSeats.mockResolvedValue(5);
    const get = jest.fn().mockResolvedValue({ seats: 2 });
    const updateSub = jest.fn().mockResolvedValue({});
    const client = fakeClient(get, updateSub);

    const result = await reconcileCompanySeats({ companyId: 'c1', polarSubscriptionId: 'sub_1' }, client);

    expect(updateSub).toHaveBeenCalledWith({ id: 'sub_1', subscriptionUpdate: { seats: 5 } });
    expect(update).toHaveBeenCalledWith({ where: { companyId: 'c1' }, data: { seats: 5 } });
    expect(result).toEqual({ corrected: true, localSeats: 5, polarSeats: 2 });
  });

  it('pushes a correction when the DB count is lower than Polar too', async () => {
    countSeats.mockResolvedValue(1);
    const get = jest.fn().mockResolvedValue({ seats: 4 });
    const updateSub = jest.fn().mockResolvedValue({});
    const client = fakeClient(get, updateSub);

    const result = await reconcileCompanySeats({ companyId: 'c1', polarSubscriptionId: 'sub_1' }, client);

    expect(updateSub).toHaveBeenCalledWith({ id: 'sub_1', subscriptionUpdate: { seats: 1 } });
    expect(result?.corrected).toBe(true);
  });

  it('propagates a Polar failure to its caller (the sweep runner decides how to isolate it)', async () => {
    countSeats.mockResolvedValue(3);
    const get = jest.fn().mockRejectedValue(new Error('polar unreachable'));
    const client = fakeClient(get);

    await expect(
      reconcileCompanySeats({ companyId: 'c1', polarSubscriptionId: 'sub_1' }, client),
    ).rejects.toThrow('polar unreachable');
  });
});
