import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { vi } from 'vitest';

import { BILLING_FLAG_NAME } from './billing-flag';
import { type CompanyTaxProfile, VAT_FRANCHISE_MENTION, VAT_REVERSE_CHARGE_MENTION } from './billing-vat';
import { buildStripePlugin } from './stripe-plugin';

// The first invoice of a subscription is finalized by Stripe as soon as the checkout completes, so it
// can only carry a mention the company's Stripe customer already has when the checkout session is
// created. The real better-auth Stripe plugin, over an in-memory database and a Stripe client that
// records every call in order, proves the customer's invoice footer is written before that session,
// for a customer created before the mention existed.
const stripe = vi.hoisted(() => ({
  log: [] as { call: string; customer?: unknown; params?: Record<string, unknown> }[],
  taxIds: [] as { id: string; type: string; value: string }[],
}));

vi.mock('./stripe-subscription-sync', () => ({ syncStripeSubscription: vi.fn() }));
vi.mock('./stripe-client', () => ({
  stripeClientFor: () => ({
    customers: {
      search: async () => ({ data: [] }),
      list: async function* () {},
      retrieve: async (id: string) => ({ id }),
      create: async (params: Record<string, unknown>) => {
        stripe.log.push({ call: 'customers.create', params });
        return { id: 'cus_new', ...params };
      },
      update: async (id: string, params: Record<string, unknown>) => {
        stripe.log.push({ call: 'customers.update', customer: id, params });
        return { id };
      },
      listTaxIds: async () => ({ data: stripe.taxIds }),
      createTaxId: async (id: string, params: Record<string, unknown>) => {
        stripe.log.push({ call: 'customers.createTaxId', customer: id, params });
        return { id: 'txi_new' };
      },
      deleteTaxId: async (id: string, taxId: string) => {
        stripe.log.push({ call: 'customers.deleteTaxId', customer: id, params: { taxId } });
        return { id: taxId, deleted: true };
      },
    },
    subscriptions: { list: async () => ({ data: [] }) },
    prices: {
      retrieve: async (id: string) => ({ id, recurring: { usage_type: 'licensed' } }),
      list: async () => ({ data: [] }),
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          stripe.log.push({ call: 'checkout.sessions.create', customer: params.customer, params });
          return { id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' };
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
const BERLIN_COMPANY: CompanyTaxProfile = {
  address: { line1: '1 Hauptstrasse', postalCode: '10115', city: 'Berlin', countryCode: 'DE' },
  vat: { value: 'DE123456789', validationStatus: 'VALID' },
};

async function checkout(env: Record<string, string>, taxProfile: CompanyTaxProfile) {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    subscription: [],
    // A customer created before this slice: no footer on it yet.
    company: [{ id: 'company-1', stripeCustomerId: 'cus_existing' }],
  };
  const plugin = buildStripePlugin(
    {
      findCompanyRole: async () => 'OWNER',
      companyHoldsFounderGrid: async () => false,
      findCompanyCustomerDetails: async () => ({ name: 'Acme GmbH', email: 'billing@acme.test' }),
      findCompanyTaxProfile: async (companyId) => (companyId === 'company-1' ? taxProfile : null),
    },
    env,
  );
  if (!plugin) throw new Error('billing is enabled, the plugin must be built');
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: 'a-test-secret-that-is-long-enough-for-better-auth',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [plugin],
    logger: { disabled: true },
  });
  const { headers } = await auth.api.signUpEmail({
    body: { email: 'owner@acme.test', password: 'Super_Secret_Password123!', name: 'Owner' },
    returnHeaders: true,
  });
  const cookie = headers.get('set-cookie')?.split(';')[0] ?? '';
  await auth.api.upgradeSubscription({
    body: {
      plan: 'standard',
      seats: 1,
      referenceId: 'company-1',
      customerType: 'organization',
      successUrl: BILLING_URL,
      cancelUrl: BILLING_URL,
      disableRedirect: true,
    },
    headers: new Headers({ cookie, origin: ORIGIN }),
  });
}

/** The invoice footer the customer holds when the checkout session is created. */
function footerAtCheckout(): unknown {
  const sessionAt = stripe.log.findIndex((entry) => entry.call === 'checkout.sessions.create');
  expect(sessionAt).toBeGreaterThan(-1);
  const updates = stripe.log
    .slice(0, sessionAt)
    .filter((entry) => entry.call === 'customers.update' && entry.customer === 'cus_existing');
  const last = updates.at(-1)?.params as { invoice_settings?: { footer?: unknown } } | undefined;
  return last?.invoice_settings?.footer;
}

beforeEach(() => {
  stripe.log.length = 0;
  stripe.taxIds.length = 0;
});

describe('VAT mention on the first subscription invoice', () => {
  it('puts the article 293 B mention on the company customer before checkout, under the franchise', async () => {
    await checkout(ENV, BERLIN_COMPANY);

    expect(footerAtCheckout()).toBe(VAT_FRANCHISE_MENTION);
    expect(stripe.log.find((e) => e.call === 'checkout.sessions.create')?.customer).toBe('cus_existing');
  });

  it('puts the reverse charge mention and the VAT number on the customer before checkout, for an EU business', async () => {
    await checkout({ ...ENV, BILLING_VAT: 'charge' }, BERLIN_COMPANY);

    expect(footerAtCheckout()).toBe(VAT_REVERSE_CHARGE_MENTION);
    const sessionAt = stripe.log.findIndex((e) => e.call === 'checkout.sessions.create');
    const taxIdAt = stripe.log.findIndex((e) => e.call === 'customers.createTaxId');
    expect(taxIdAt).toBeGreaterThan(-1);
    expect(taxIdAt).toBeLessThan(sessionAt);
    expect(stripe.log[taxIdAt].params).toEqual({ type: 'eu_vat', value: 'DE123456789' });
    // Checkout charges through Stripe Tax and cannot replace the address the mention was decided on.
    expect(stripe.log[sessionAt].params).toMatchObject({
      automatic_tax: { enabled: true },
      customer_update: { address: 'never', name: 'never' },
    });
    expect(stripe.log[sessionAt].params).not.toHaveProperty('tax_id_collection');
  });

  it('clears any franchise mention before checkout for a French company charged VAT', async () => {
    const parisCompany: CompanyTaxProfile = {
      address: { line1: '1 rue de Rivoli', postalCode: '75001', city: 'Paris', countryCode: 'FR' },
      vat: { value: 'FR12345678901', validationStatus: 'VALID' },
    };
    await checkout({ ...ENV, BILLING_VAT: 'charge' }, parisCompany);

    expect(footerAtCheckout()).toBe('');
    expect(stripe.log.some((e) => e.call === 'customers.createTaxId')).toBe(false);
  });
});
