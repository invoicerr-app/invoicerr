import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { stripeClientFor } from './stripe-client';
import { cancelCompanyStripeSubscriptions, type StripeSubscriptionsApi } from './stripe-subscription-cancel';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { subscription: { findMany: vi.fn() } },
}));

vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./stripe-client', () => ({ stripeClientFor: vi.fn() }));

const findMany = prisma.subscription.findMany as Mock;

function fakeApi(overrides: Partial<Record<keyof StripeSubscriptionsApi, Mock>> = {}) {
  return {
    cancel: overrides.cancel ?? vi.fn().mockResolvedValue({}),
    retrieve: overrides.retrieve ?? vi.fn().mockResolvedValue({ status: 'active' }),
  };
}

describe('cancelCompanyStripeSubscriptions', () => {
  const previous = process.env[BILLING_FLAG_NAME];
  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
  });
  afterEach(() => {
    vi.resetAllMocks();
    if (previous === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = previous;
  });

  it('cancels every subscription Stripe can still charge for the company', async () => {
    findMany.mockResolvedValue([{ stripeSubscriptionId: 'sub_a' }, { stripeSubscriptionId: 'sub_b' }]);
    const api = fakeApi();

    expect(await cancelCompanyStripeSubscriptions('c1', api)).toBe(2);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        referenceId: 'c1',
        stripeSubscriptionId: { not: null },
        status: { in: ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'] },
      },
      select: { stripeSubscriptionId: true },
    });
    expect(api.cancel.mock.calls).toEqual([['sub_a'], ['sub_b']]);
  });

  it('treats a subscription Stripe already ended as cancelled', async () => {
    findMany.mockResolvedValue([{ stripeSubscriptionId: 'sub_a' }]);
    const api = fakeApi({
      cancel: vi.fn().mockRejectedValue(new Error('already canceled')),
      retrieve: vi.fn().mockResolvedValue({ status: 'canceled' }),
    });

    await expect(cancelCompanyStripeSubscriptions('c1', api)).resolves.toBe(0);
  });

  it('throws when Stripe refuses and the subscription is still live', async () => {
    findMany.mockResolvedValue([{ stripeSubscriptionId: 'sub_a' }]);
    const api = fakeApi({ cancel: vi.fn().mockRejectedValue(new Error('Stripe is down')) });

    await expect(cancelCompanyStripeSubscriptions('c1', api)).rejects.toThrow('Stripe is down');
  });

  it('throws when Stripe cannot even be asked', async () => {
    findMany.mockResolvedValue([{ stripeSubscriptionId: 'sub_a' }]);
    const api = fakeApi({
      cancel: vi.fn().mockRejectedValue(new Error('network')),
      retrieve: vi.fn().mockRejectedValue(new Error('network')),
    });

    await expect(cancelCompanyStripeSubscriptions('c1', api)).rejects.toThrow('network');
  });

  it('does nothing when billing is off', async () => {
    delete process.env[BILLING_FLAG_NAME];
    const api = fakeApi();

    expect(await cancelCompanyStripeSubscriptions('c1', api)).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('does not build a Stripe client when the company has no subscription to cancel', async () => {
    findMany.mockResolvedValue([]);

    expect(
      await cancelCompanyStripeSubscriptions('c1', undefined, {
        [BILLING_FLAG_NAME]: 'true',
        STRIPE_SECRET_KEY: 'sk_test_x',
      }),
    ).toBe(0);
    expect(stripeClientFor).not.toHaveBeenCalled();
  });

  it('skips cancellation without a Stripe key instead of failing the deletion', async () => {
    findMany.mockResolvedValue([{ stripeSubscriptionId: 'sub_a' }]);

    expect(
      await cancelCompanyStripeSubscriptions('c1', undefined, {
        [BILLING_FLAG_NAME]: 'true',
        STRIPE_SECRET_KEY: ' ',
      }),
    ).toBe(0);
    expect(stripeClientFor).not.toHaveBeenCalled();
  });

  it('uses the Stripe client from the key when one is configured', async () => {
    findMany.mockResolvedValue([{ stripeSubscriptionId: 'sub_a' }]);
    const api = fakeApi();
    (stripeClientFor as Mock).mockReturnValue({ subscriptions: api });
    const env = { [BILLING_FLAG_NAME]: 'true', STRIPE_SECRET_KEY: 'sk_test_x' };

    expect(await cancelCompanyStripeSubscriptions('c1', undefined, env)).toBe(1);
    expect(stripeClientFor).toHaveBeenCalledWith(env);
    expect(api.cancel).toHaveBeenCalledWith('sub_a');
  });
});
