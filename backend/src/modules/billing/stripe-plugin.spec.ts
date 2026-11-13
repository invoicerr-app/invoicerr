import { BILLING_FLAG_NAME } from './billing-flag';
import {
  buildStripePlans,
  buildStripePlugin,
  canActOnCompanySubscription,
  type FindCompanyRole,
} from './stripe-plugin';

const roles: Record<string, string> = {
  'owner:c1': 'OWNER',
  'admin:c1': 'ADMIN',
  'member:c1': 'MEMBER',
};
const findCompanyRole: FindCompanyRole = async (userId, companyId) => roles[`${userId}:${companyId}`] ?? null;

describe('canActOnCompanySubscription', () => {
  it.each([
    'upgrade-subscription',
    'cancel-subscription',
    'restore-subscription',
    'billing-portal',
  ])('lets an owner or admin %s, never a plain member', async (action) => {
    expect(await canActOnCompanySubscription(findCompanyRole, 'owner', 'c1', action)).toBe(true);
    expect(await canActOnCompanySubscription(findCompanyRole, 'admin', 'c1', action)).toBe(true);
    expect(await canActOnCompanySubscription(findCompanyRole, 'member', 'c1', action)).toBe(false);
  });

  it('lets any member list the company subscription', async () => {
    expect(await canActOnCompanySubscription(findCompanyRole, 'member', 'c1', 'list-subscription')).toBe(
      true,
    );
  });

  it('refuses a checkout on the founder plan, whatever the role or case', async () => {
    for (const plan of ['founder', 'Founder']) {
      expect(
        await canActOnCompanySubscription(findCompanyRole, 'owner', 'c1', 'upgrade-subscription', { plan }),
      ).toBe(false);
    }
  });

  it('lets an owner check out on the standard plan', async () => {
    expect(
      await canActOnCompanySubscription(findCompanyRole, 'owner', 'c1', 'upgrade-subscription', {
        plan: 'standard',
      }),
    ).toBe(true);
  });

  it('keeps founder subscribers able to manage their subscription', async () => {
    expect(
      await canActOnCompanySubscription(findCompanyRole, 'owner', 'c1', 'billing-portal', {
        plan: 'founder',
      }),
    ).toBe(true);
  });

  it('refuses a user who does not belong to the company', async () => {
    expect(await canActOnCompanySubscription(findCompanyRole, 'owner', 'c2', 'list-subscription')).toBe(
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
  const ENABLED = {
    [BILLING_FLAG_NAME]: 'true',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_STANDARD_MONTHLY: 'price_sm',
    STRIPE_PRICE_STANDARD_YEARLY: 'price_sy',
  };

  it('builds nothing while billing is disabled', () => {
    expect(buildStripePlugin(findCompanyRole, {})).toBeNull();
  });

  it('refuses to build with billing enabled and no Stripe keys', () => {
    expect(() => buildStripePlugin(findCompanyRole, { [BILLING_FLAG_NAME]: 'true' })).toThrow(
      /STRIPE_SECRET_KEY is not set/,
    );
  });

  it('refuses to build with billing enabled and no price catalog', () => {
    const { STRIPE_PRICE_STANDARD_MONTHLY, STRIPE_PRICE_STANDARD_YEARLY, ...noPrices } = ENABLED;
    expect(() => buildStripePlugin(findCompanyRole, noPrices)).toThrow(
      /STRIPE_PRICE_STANDARD_MONTHLY is not set/,
    );
  });

  it('hands the plugin the plans built from the price catalog', () => {
    const plugin = buildStripePlugin(findCompanyRole, ENABLED);
    expect(plugin?.options.subscription).toMatchObject({
      enabled: true,
      plans: [{ name: 'standard', priceId: 'price_sm', annualDiscountPriceId: 'price_sy' }],
    });
  });

  it('builds the plugin with subscriptions enabled when configured', () => {
    const plugin = buildStripePlugin(findCompanyRole, ENABLED);
    expect(plugin?.id).toBe('stripe');
    expect(Object.keys(plugin?.endpoints ?? {})).toEqual(
      expect.arrayContaining(['stripeWebhook', 'upgradeSubscription', 'createBillingPortal']),
    );
  });
});
