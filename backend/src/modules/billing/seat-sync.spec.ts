import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { getPolarClient } from './polar-client';
import { countCompanySeats, syncCompanySeatsOnMembershipChange } from './seat-sync';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: { count: jest.fn() },
    companySubscription: { update: jest.fn() },
  },
}));
jest.mock('./company-subscription.store');
jest.mock('./polar-client');

const count = prisma.userCompany.count as jest.Mock;
const update = prisma.companySubscription.update as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const getClient = getPolarClient as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

describe('syncCompanySeatsOnMembershipChange', () => {
  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
  });

  afterEach(() => {
    jest.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op when billing is disabled', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await syncCompanySeatsOnMembershipChange('company-1');
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('updates the stored seat count when it changed, but never calls Polar without a polarSubscriptionId', async () => {
    getOrCreate.mockResolvedValue({ seats: 1, polarSubscriptionId: null });
    count.mockResolvedValue(3);

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(update).toHaveBeenCalledWith({ where: { companyId: 'company-1' }, data: { seats: 3 } });
    expect(getClient).not.toHaveBeenCalled();
  });

  it('does not write when the count did not change', async () => {
    getOrCreate.mockResolvedValue({ seats: 2, polarSubscriptionId: null });
    count.mockResolvedValue(2);

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(update).not.toHaveBeenCalled();
  });

  it('pushes the new seat count to Polar via subscriptions.update when a polarSubscriptionId exists', async () => {
    getOrCreate.mockResolvedValue({ seats: 1, polarSubscriptionId: 'polar_sub_123' });
    count.mockResolvedValue(4);
    const subscriptionsUpdate = jest.fn().mockResolvedValue({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(subscriptionsUpdate).toHaveBeenCalledWith({
      id: 'polar_sub_123',
      subscriptionUpdate: { seats: 4 },
    });
  });

  it('never throws — a Polar failure is logged and swallowed', async () => {
    getOrCreate.mockResolvedValue({ seats: 1, polarSubscriptionId: 'polar_sub_123' });
    count.mockResolvedValue(2);
    getClient.mockReturnValue({
      subscriptions: { update: jest.fn().mockRejectedValue(new Error('polar is down')) },
    });

    await expect(syncCompanySeatsOnMembershipChange('company-1')).resolves.toBeUndefined();
  });
});

describe('countCompanySeats', () => {
  afterEach(() => jest.resetAllMocks());

  it('counts UserCompany rows for the company', async () => {
    count.mockResolvedValue(5);
    await expect(countCompanySeats('company-1')).resolves.toBe(5);
    expect(count).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
  });
});
