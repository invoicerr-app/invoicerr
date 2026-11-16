import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { vi } from 'vitest';

import { BILLING_FLAG_NAME } from './billing-flag';
import { buildStripePlugin, type FindCompanyRole } from './stripe-plugin';

// The real better-auth Stripe plugin, as `lib/auth.ts` builds it, over an in-memory database and a
// recording Stripe client: proves which Stripe customer checkout and the Customer Portal open on.
const stripeCalls = vi.hoisted(() => ({
  customersCreated: [] as Record<string, unknown>[],
  checkoutCustomers: [] as unknown[],
  portalCustomers: [] as unknown[],
}));

vi.mock('./stripe-subscription-sync', () => ({ syncStripeSubscription: vi.fn() }));
vi.mock('./stripe-client', () => ({
  stripeClientFor: () => ({
    customers: {
      search: async () => ({ data: [] }),
      list: async function* () {},
      create: async (params: Record<string, unknown>) => {
        stripeCalls.customersCreated.push(params);
        return { id: `cus_created_${stripeCalls.customersCreated.length}`, ...params };
      },
    },
    subscriptions: { list: async () => ({ data: [] }) },
    prices: {
      retrieve: async (id: string) => ({ id, recurring: { usage_type: 'licensed' } }),
      list: async () => ({ data: [] }),
    },
    checkout: {
      sessions: {
        create: async (params: { customer?: unknown }) => {
          stripeCalls.checkoutCustomers.push(params.customer);
          return { id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: { customer?: unknown }) => {
          stripeCalls.portalCustomers.push(params.customer);
          return { url: 'https://billing.stripe.test/session' };
        },
      },
    },
  }),
}));

const ORIGIN = 'http://localhost:3000';
const BILLING_URL = `${ORIGIN}/settings/billing`;
const ENV = {
  [BILLING_FLAG_NAME]: 'true',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_STANDARD_MONTHLY: 'price_sm',
  STRIPE_PRICE_STANDARD_YEARLY: 'price_sy',
};

function setup() {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    subscription: [],
    company: [{ id: 'company-1', stripeCustomerId: null }],
  };
  const roles: Record<string, string> = {};
  const findCompanyRole: FindCompanyRole = async (userId, companyId) =>
    roles[`${userId}:${companyId}`] ?? null;
  const plugin = buildStripePlugin(
    {
      findCompanyRole,
      findCompanyCustomerDetails: async (companyId) =>
        companyId === 'company-1' ? { name: 'Acme Corp', email: 'billing@acme.test' } : null,
    },
    ENV,
  );
  if (!plugin) throw new Error('billing is enabled in ENV, the plugin must be built');
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: 'a-test-secret-that-is-long-enough-for-better-auth',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [plugin],
    logger: { disabled: true },
  });

  async function signIn(email: string, role: string, ownStripeCustomerId: string): Promise<Headers> {
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: 'Super_Secret_Password123!', name: email },
      returnHeaders: true,
    });
    const user = db.user.find((u) => u.id === response.user.id);
    if (!user) throw new Error(`user ${email} was not stored`);
    // Each admin already has a Stripe customer of their own, from another company or a past checkout.
    user.stripeCustomerId = ownStripeCustomerId;
    roles[`${response.user.id}:company-1`] = role;
    const cookie = headers.get('set-cookie')?.split(';')[0];
    return new Headers({ cookie: cookie ?? '', origin: ORIGIN });
  }

  return { auth, db, signIn };
}

beforeEach(() => {
  stripeCalls.customersCreated.length = 0;
  stripeCalls.checkoutCustomers.length = 0;
  stripeCalls.portalCustomers.length = 0;
});

describe('company Stripe customer', () => {
  it('opens checkout and the portal on the company customer for two admins who each have their own', async () => {
    const { auth, db, signIn } = setup();
    const owner = await signIn('owner@acme.test', 'OWNER', 'cus_owner_personal');
    const admin = await signIn('admin@acme.test', 'ADMIN', 'cus_admin_personal');
    const checkoutBody = {
      plan: 'standard',
      seats: 2,
      referenceId: 'company-1',
      customerType: 'organization' as const,
      successUrl: BILLING_URL,
      cancelUrl: BILLING_URL,
      disableRedirect: true,
    };

    await auth.api.upgradeSubscription({ body: checkoutBody, headers: owner });
    await auth.api.upgradeSubscription({ body: checkoutBody, headers: admin });

    // One customer, created once for the company with its own name and billing email.
    expect(stripeCalls.customersCreated).toHaveLength(1);
    expect(stripeCalls.customersCreated[0]).toMatchObject({
      name: 'Acme Corp',
      email: 'billing@acme.test',
      metadata: { organizationId: 'company-1', customerType: 'organization' },
    });
    expect(db.company[0].stripeCustomerId).toBe('cus_created_1');
    expect(stripeCalls.checkoutCustomers).toEqual(['cus_created_1', 'cus_created_1']);

    const portalBody = {
      referenceId: 'company-1',
      customerType: 'organization' as const,
      returnUrl: BILLING_URL,
      disableRedirect: true,
    };
    await auth.api.createBillingPortal({ body: portalBody, headers: owner });
    await auth.api.createBillingPortal({ body: portalBody, headers: admin });

    expect(stripeCalls.portalCustomers).toEqual(['cus_created_1', 'cus_created_1']);
    // Neither admin's own customer was touched.
    expect(db.user.map((u) => u.stripeCustomerId).sort()).toEqual([
      'cus_admin_personal',
      'cus_owner_personal',
    ]);
  });

  it('refuses a portal or checkout call that would fall back to the clicking user customer', async () => {
    const { auth, signIn } = setup();
    const admin = await signIn('admin@acme.test', 'ADMIN', 'cus_admin_personal');

    await expect(
      auth.api.createBillingPortal({
        body: { referenceId: 'company-1', returnUrl: BILLING_URL, disableRedirect: true },
        headers: admin,
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    await expect(
      auth.api.upgradeSubscription({
        body: {
          plan: 'standard',
          referenceId: 'company-1',
          successUrl: BILLING_URL,
          cancelUrl: BILLING_URL,
          disableRedirect: true,
        },
        headers: admin,
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    expect(stripeCalls.portalCustomers).toEqual([]);
    expect(stripeCalls.checkoutCustomers).toEqual([]);
  });

  it('keeps a plain member away from the company portal', async () => {
    const { auth, signIn } = setup();
    const member = await signIn('member@acme.test', 'MEMBER', 'cus_member_personal');

    await expect(
      auth.api.createBillingPortal({
        body: {
          referenceId: 'company-1',
          customerType: 'organization',
          returnUrl: BILLING_URL,
          disableRedirect: true,
        },
        headers: member,
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
    expect(stripeCalls.portalCustomers).toEqual([]);
  });
});
