import { BILLING_FLAG_NAME } from './billing-flag';
import { buildStripePlugin, canActOnCompanySubscription, type FindCompanyRole } from './stripe-plugin';

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

  it('refuses a user who does not belong to the company', async () => {
    expect(await canActOnCompanySubscription(findCompanyRole, 'owner', 'c2', 'list-subscription')).toBe(
      false,
    );
  });
});

describe('buildStripePlugin', () => {
  const ENABLED = {
    [BILLING_FLAG_NAME]: 'true',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  };

  it('builds nothing while billing is disabled', () => {
    expect(buildStripePlugin(findCompanyRole, {})).toBeNull();
  });

  it('refuses to build with billing enabled and no Stripe keys', () => {
    expect(() => buildStripePlugin(findCompanyRole, { [BILLING_FLAG_NAME]: 'true' })).toThrow(
      /STRIPE_SECRET_KEY is not set/,
    );
  });

  it('builds the plugin with subscriptions enabled when configured', () => {
    const plugin = buildStripePlugin(findCompanyRole, ENABLED);
    expect(plugin?.id).toBe('stripe');
    expect(Object.keys(plugin?.endpoints ?? {})).toEqual(
      expect.arrayContaining(['stripeWebhook', 'upgradeSubscription', 'createBillingPortal']),
    );
  });
});
