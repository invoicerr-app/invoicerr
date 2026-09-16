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
  default: {
    companySubscription: { update: jest.fn() },
    company: { findUnique: jest.fn() },
  },
}));
jest.mock('./company-subscription.store');

const update = prisma.companySubscription.update as jest.Mock;
const findCompany = prisma.company.findUnique as jest.Mock;
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
  beforeEach(() => {
    // The common case: the resolved companyId is a real, still-existing company. Tests for the
    // opposite override this per-case.
    findCompany.mockResolvedValue({ id: 'company-1' });
  });
  afterEach(() => jest.resetAllMocks());

  it('lazily ensures the row exists, then writes status/ids/interval', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

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
        seatPaymentFailedAt: null,
      },
    });
  });

  it('a PAST_DUE status does not touch blockedAt/zipSentAt/deletionDueAt/seatPaymentFailedAt', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

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

  it('a monthly-to-yearly plan change made from the Polar customer portal (subscription.updated) updates the stored interval to the NEW product, no separate handling needed', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null, interval: 'MONTH' });

    // The subscription object's own `recurringInterval` is what actually changes once a customer
    // switches products through the portal — same subscription id, same customer, only the interval
    // (and, Polar-side, the product) differ. `subscription.updated` carries this the SAME way every
    // other subscription event does, so no event-name branching is needed to catch it.
    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1', // same subscription — a plan CHANGE, not a new one
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'year',
    });

    expect(update.mock.calls[0][0].data).toMatchObject({ interval: 'YEAR' });
  });

  it('an unrecognized recurringInterval leaves the stored interval untouched', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

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

  it('ignores a webhook whose resolved companyId matches no company — deleted, never a 500', async () => {
    findCompany.mockResolvedValue(null);

    await expect(
      applySubscriptionWebhook({
        companyId: 'gone-company',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
      }),
    ).resolves.toBeUndefined();

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores a webhook for a pre-migration, per-USER customer (external_id is a user id, not a company id) the same way', async () => {
    // Under option A a real company's customer external_id is always `company.id` — an old customer's
    // external_id is a USER id, which simply matches no row in `Company` either.
    findCompany.mockResolvedValue(null);

    await expect(
      applySubscriptionWebhook({
        companyId: 'user_cGfd91',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_legacy',
        status: 'active',
        recurringInterval: 'month',
      }),
    ).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
  });

  it('applies a fact unconditionally when no prior fact was ever recorded, and persists factAt', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });
    const factAt = new Date('2026-09-16T10:00:00Z');

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      factAt,
    });

    expect(update.mock.calls[0][0].data).toMatchObject({ lastPolarFactAt: factAt });
  });

  it('ignores a fact OLDER than the last one already applied — a reconcile read racing a fresher webhook', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      lastPolarFactAt: new Date('2026-09-16T10:05:00Z'),
    });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'past_due',
      recurringInterval: 'month',
      factAt: new Date('2026-09-16T10:00:00Z'), // older than lastPolarFactAt
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('applies a fact NEWER than the last one already applied', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      lastPolarFactAt: new Date('2026-09-16T10:00:00Z'),
    });

    await applySubscriptionWebhook({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
      factAt: new Date('2026-09-16T10:05:00Z'),
    });

    expect(update).toHaveBeenCalled();
  });
});

// Moved here from `polar-plugin.spec.ts` 2026-09-15 alongside `handleSubscriptionPayload` itself —
// see this file's own header. Exercises the REAL `applySubscriptionWebhook` (not a mock of it, unlike
// the old spec) through the SAME prisma double already declared above — end-to-end within this file's
// own boundary, `PolarWebhookController` (the function's real caller now) mocks this whole module.
describe('handleSubscriptionPayload', () => {
  beforeEach(() => {
    findCompany.mockResolvedValue({ id: 'company-1' });
  });
  afterEach(() => jest.resetAllMocks());

  it('applies the webhook using the customer external id (primary signal, option A)', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

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
        seatPaymentFailedAt: null,
      },
    });
  });

  it('falls back to metadata.companyId when the payload carries no customer external id', async () => {
    getOrCreate.mockResolvedValue({ companyId: 'company-1', lastPolarFactAt: null });

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
    findCompany.mockResolvedValue({ id: 'company-primary' });
    getOrCreate.mockResolvedValue({ companyId: 'company-primary', lastPolarFactAt: null });

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

  it('threads factAt through to applySubscriptionWebhook, so a stale reconcile read never overwrites a fresher webhook fact', async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      lastPolarFactAt: new Date('2026-09-16T10:05:00Z'),
    });

    await handleSubscriptionPayload(
      {
        data: {
          id: 'sub_1',
          customerId: 'cus_1',
          status: 'past_due',
          recurringInterval: 'month',
          metadata: {},
          customerExternalId: 'company-1',
        },
      },
      new Date('2026-09-16T10:00:00Z'),
    );

    expect(update).not.toHaveBeenCalled();
  });
});
