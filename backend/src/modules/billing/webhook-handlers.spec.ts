import prisma from '@/prisma/prisma.service';

import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  applySubscriptionWebhook,
  mapPolarRecurringInterval,
  mapPolarSubscriptionStatus,
} from './webhook-handlers';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { companySubscription: { update: jest.fn() } },
}));
jest.mock('./company-subscription.store');

const update = prisma.companySubscription.update as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;

describe('mapPolarSubscriptionStatus', () => {
  it.each(['active', 'trialing'])('%s maps to ACTIVE', (status) => {
    expect(mapPolarSubscriptionStatus(status)).toBe('ACTIVE');
  });

  it.each([
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ])('%s maps to PAST_DUE', (status) => {
    expect(mapPolarSubscriptionStatus(status)).toBe('PAST_DUE');
  });
});

describe('mapPolarRecurringInterval', () => {
  it('maps month/year, and null for anything else', () => {
    expect(mapPolarRecurringInterval('month')).toBe('MONTH');
    expect(mapPolarRecurringInterval('year')).toBe('YEAR');
    expect(mapPolarRecurringInterval('week')).toBeNull();
    expect(mapPolarRecurringInterval('day')).toBeNull();
  });
});

describe('applySubscriptionWebhook', () => {
  afterEach(() => jest.resetAllMocks());

  it('lazily ensures the row exists, then writes status/ids/interval', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1' });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: {
        status: 'ACTIVE',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        interval: 'MONTH',
        blockedAt: null,
        zipSentAt: null,
        deletionDueAt: null,
      },
    });
  });

  it('a PAST_DUE status does not touch blockedAt/zipSentAt/deletionDueAt', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1' });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'canceled',
      recurringInterval: 'year',
    });

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: {
        status: 'PAST_DUE',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        interval: 'YEAR',
      },
    });
  });

  it('an unrecognized recurringInterval leaves the stored interval untouched', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1' });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'week',
    });

    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('interval');
  });
});
