import prisma from '@/prisma/prisma.service';

import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  applySubscriptionWebhook,
  handleSubscriptionPayload,
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

// Moved here from `polar-plugin.spec.ts` 2026-09-15 alongside `handleSubscriptionPayload` itself —
// see this file's own header. Exercises the REAL `applySubscriptionWebhook` (not a mock of it, unlike
// the old spec) through the SAME prisma double already declared above — end-to-end within this file's
// own boundary, `PolarWebhookController` (the function's real caller now) mocks this whole module.
describe('handleSubscriptionPayload', () => {
  afterEach(() => jest.resetAllMocks());

  it('applies the webhook using the customer external id (primary signal, option A)', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1' });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: {},
        customerExternalId: 'company-1',
      },
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

  it('falls back to metadata.companyId when the payload carries no customer external id', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1' });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: { companyId: 'company-1' },
      },
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-1' } }));
  });

  it('prefers the customer external id over metadata.companyId when both are present', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-primary' });

    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: { companyId: 'company-fallback' },
        customerExternalId: 'company-primary',
      },
    });

    expect(getOrCreate).toHaveBeenCalledWith('company-primary');
  });

  it('drops a payload with no companyId anywhere, without throwing or touching the DB', async () => {
    await expect(
      handleSubscriptionPayload({
        data: {
          id: 'sub_1',
          customerId: 'cus_1',
          status: 'active',
          recurringInterval: 'month',
          metadata: {},
        },
      }),
    ).resolves.toBeUndefined();

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
