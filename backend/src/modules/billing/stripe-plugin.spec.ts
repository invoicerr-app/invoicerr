import { vi } from 'vitest';

import { BILLING_FLAG_NAME } from './billing-flag';
import {
  buildStripePlans,
  buildStripePlugin,
  canActOnCompanySubscription,
  type FindCompanyRole,
  subscriptionSyncHooks,
} from './stripe-plugin';
import { recordFounderPreorderEvent } from './founder-preorder';
import { syncStripeSubscription } from './stripe-subscription-sync';

vi.mock('./stripe-subscription-sync', () => ({ syncStripeSubscription: vi.fn() }));
vi.mock('./founder-preorder', () => ({ recordFounderPreorderEvent: vi.fn() }));

const roles: Record<string, string> = {
  'owner:c1': 'OWNER',
  'admin:c1': 'ADMIN',
  'member:c1': 'MEMBER',
};
const findCompanyRole: FindCompanyRole = async (userId, companyId) => roles[`${userId}:${companyId}`] ?? null;
const founderCompanies = new Set<string>();
const companyHoldsFounderGrid = async (companyId: string) => founderCompanies.has(companyId);
const access = { findCompanyRole, companyHoldsFounderGrid };
afterEach(() => founderCompanies.clear());

const ORG = 'organization';
const COMPANY = { customerType: ORG };

describe('canActOnCompanySubscription', () => {
  it.each([
    'upgrade-subscription',
    'cancel-subscription',
    'restore-subscription',
    'billing-portal',
  ])('lets an owner or admin %s, never a plain member', async (action) => {
    expect(await canActOnCompanySubscription(access, 'owner', 'c1', action, COMPANY)).toBe(true);
    expect(await canActOnCompanySubscription(access, 'admin', 'c1', action, COMPANY)).toBe(true);
    expect(await canActOnCompanySubscription(access, 'member', 'c1', action, COMPANY)).toBe(false);
  });

  it('lets any member list the company subscription', async () => {
    expect(await canActOnCompanySubscription(access, 'member', 'c1', 'list-subscription', COMPANY)).toBe(
      true,
    );
  });

  it('refuses a checkout on the founder plan to a company without the founder grid', async () => {
    for (const plan of ['founder', 'Founder']) {
      expect(
        await canActOnCompanySubscription(access, 'owner', 'c1', 'upgrade-subscription', {
          plan,
          customerType: ORG,
        }),
      ).toBe(false);
    }
  });

  it('lets an owner or admin of a founder company check out on the founder plan, not a member', async () => {
    founderCompanies.add('c1');
    const body = { plan: 'Founder', customerType: ORG };
    expect(await canActOnCompanySubscription(access, 'owner', 'c1', 'upgrade-subscription', body)).toBe(true);
    expect(await canActOnCompanySubscription(access, 'admin', 'c1', 'upgrade-subscription', body)).toBe(true);
    expect(await canActOnCompanySubscription(access, 'member', 'c1', 'upgrade-subscription', body)).toBe(
      false,
    );
  });

  it('lets an owner check out on the standard plan', async () => {
    expect(
      await canActOnCompanySubscription(access, 'owner', 'c1', 'upgrade-subscription', {
        plan: 'standard',
        customerType: ORG,
      }),
    ).toBe(true);
  });

  it('keeps founder subscribers able to manage their subscription', async () => {
    expect(
      await canActOnCompanySubscription(access, 'owner', 'c1', 'billing-portal', {
        plan: 'founder',
        customerType: ORG,
      }),
    ).toBe(true);
  });

  it('refuses every action that would bill the Stripe customer of the user who clicks', async () => {
    for (const action of [
      'upgrade-subscription',
      'billing-portal',
      'cancel-subscription',
      'list-subscription',
    ]) {
      expect(await canActOnCompanySubscription(access, 'owner', 'c1', action)).toBe(false);
      expect(await canActOnCompanySubscription(access, 'owner', 'c1', action, { customerType: 'user' })).toBe(
        false,
      );
    }
  });

  it('accepts the company customer type from the query string, as the list call sends it', async () => {
    expect(
      await canActOnCompanySubscription(access, 'member', 'c1', 'list-subscription', undefined, COMPANY),
    ).toBe(true);
  });

  it('refuses a user who does not belong to the company', async () => {
    expect(await canActOnCompanySubscription(access, 'owner', 'c2', 'list-subscription', COMPANY)).toBe(
      false,
    );
  });
});

describe('buildStripePlans', () => {
  it('builds one standard plan, monthly price first and yearly as its annual price', () => {
    expect(
      buildStripePlans({ standard: { monthly: 'price_sm', yearly: 'price_sy' }, founder: null }),
    ).toEqual([{ name: 'standard', priceId: 'price_sm', annualDiscountPriceId: 'price_sy' }]);
  });

  it('adds the founder plan when the founder grid is configured', () => {
    expect(
      buildStripePlans({
        standard: { monthly: 'price_sm', yearly: 'price_sy' },
        founder: { monthly: 'price_fm', yearly: 'price_fy' },
      }),
    ).toEqual([
      { name: 'standard', priceId: 'price_sm', annualDiscountPriceId: 'price_sy' },
      { name: 'founder', priceId: 'price_fm', annualDiscountPriceId: 'price_fy' },
    ]);
  });
});

describe('buildStripePlugin', () => {
  const deps = { ...access, findCompanyCustomerDetails: async () => null };
  const ENABLED = {
    [BILLING_FLAG_NAME]: 'true',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_STANDARD_MONTHLY: 'price_sm',
    STRIPE_PRICE_STANDARD_YEARLY: 'price_sy',
  };

  it('builds nothing while billing is disabled', () => {
    expect(buildStripePlugin(deps, {})).toBeNull();
  });

  it('refuses to build with billing enabled and no Stripe keys', () => {
    expect(() => buildStripePlugin(deps, { [BILLING_FLAG_NAME]: 'true' })).toThrow(
      /STRIPE_SECRET_KEY is not set/,
    );
  });

  it('refuses to build with billing enabled and no price catalog', () => {
    const { STRIPE_PRICE_STANDARD_MONTHLY, STRIPE_PRICE_STANDARD_YEARLY, ...noPrices } = ENABLED;
    expect(() => buildStripePlugin(deps, noPrices)).toThrow(/STRIPE_PRICE_STANDARD_MONTHLY is not set/);
  });

  it('hands the plugin the plans built from the price catalog', () => {
    const plugin = buildStripePlugin(deps, ENABLED);
    expect(plugin?.options.subscription).toMatchObject({
      enabled: true,
      plans: [{ name: 'standard', priceId: 'price_sm', annualDiscountPriceId: 'price_sy' }],
    });
  });

  it('builds the plugin with subscriptions enabled when configured', () => {
    const plugin = buildStripePlugin(deps, ENABLED);
    expect(plugin?.id).toBe('stripe');
    expect(Object.keys(plugin?.endpoints ?? {})).toEqual(
      expect.arrayContaining(['stripeWebhook', 'upgradeSubscription', 'createBillingPortal']),
    );
  });

  it('syncs the company row from every subscription hook that reports a state', () => {
    const plugin = buildStripePlugin(deps, ENABLED);
    expect(plugin?.options.subscription).toMatchObject(subscriptionSyncHooks);
    expect(plugin?.options.subscription).not.toHaveProperty('onSubscriptionCancel');
  });

  it('hands every webhook event to the founder pre-order recorder', async () => {
    const plugin = buildStripePlugin(deps, ENABLED);
    const event = { type: 'checkout.session.completed', created: 1, data: { object: {} } };
    await plugin?.options.onEvent?.(event as never);
    expect(recordFounderPreorderEvent).toHaveBeenCalledWith(event);
  });
});

describe('subscriptionSyncHooks', () => {
  it.each(Object.keys(subscriptionSyncHooks))('%s hands the hook data to the company sync', async (hook) => {
    const data = {
      event: { created: 1 },
      subscription: { id: 'ps1', referenceId: 'c1', status: 'active' },
    };
    await subscriptionSyncHooks[hook as keyof typeof subscriptionSyncHooks](data);
    expect(syncStripeSubscription).toHaveBeenCalledWith(data);
  });
});
