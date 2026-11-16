import { type StripePlan, stripe } from '@better-auth/stripe';
import { isBillingEnabled } from './billing-flag';
import { stripeClientFor } from './stripe-client';
import { assertStripeEnvConfiguredForBoot } from './stripe-env';
import { type PriceGrid, readStripePriceCatalog, type StripePriceCatalog } from './stripe-price-catalog';
import { type StripeSubscriptionHookData, syncStripeSubscription } from './stripe-subscription-sync';

type StripePluginOptions = Parameters<typeof stripe>[0];

export type CompanyBillingRole = 'OWNER' | 'ADMIN' | 'MEMBER' | string;

export type FindCompanyRole = (userId: string, companyId: string) => Promise<CompanyBillingRole | null>;

/** What the company's Stripe customer is created with: its own name and billing email. */
export interface CompanyCustomerDetails {
  name: string;
  email: string;
}

export type FindCompanyCustomerDetails = (companyId: string) => Promise<CompanyCustomerDetails | null>;

export type CompanyHoldsFounderGrid = (companyId: string) => Promise<boolean>;

/** What deciding whether a user may act on a company subscription reads. */
export interface CompanyBillingAccess {
  findCompanyRole: FindCompanyRole;
  companyHoldsFounderGrid: CompanyHoldsFounderGrid;
}

export interface StripePluginDeps extends CompanyBillingAccess {
  findCompanyCustomerDetails: FindCompanyCustomerDetails;
}

const READ_ONLY_ACTIONS = new Set(['list-subscription']);
const BILLING_MANAGERS = new Set(['OWNER', 'ADMIN']);

// One plan per price grid: the monthly price is the plan's price, the yearly one its annual price
// (`annual: true` on upgrade). The seat count is the subscription quantity; the graduated tiers inside
// each price turn it into the amount, so no plan carries a seat price of its own.
export function buildStripePlans(catalog: StripePriceCatalog): StripePlan[] {
  const grids: [PriceGrid, StripePriceCatalog[PriceGrid]][] = [
    ['standard', catalog.standard],
    ['founder', catalog.founder],
  ];
  return grids.flatMap(([grid, prices]) =>
    prices ? [{ name: grid, priceId: prices.monthly, annualDiscountPriceId: prices.yearly }] : [],
  );
}

// Only a company that holds the founder grid may check out on the founder plan (`founder-grid.ts`):
// granted per company, kept while it renews without interruption.
const isFounderCheckout = (action: string, body: unknown): boolean =>
  action === 'upgrade-subscription' &&
  typeof (body as { plan?: unknown } | undefined)?.plan === 'string' &&
  (body as { plan: string }).plan.toLowerCase() === 'founder';

// A company subscription is always billed to the company's own Stripe customer: the plugin's
// `organization` customer type, whose model is the Company table here. The default `user` type would
// bill, and open the portal on, the Stripe customer of whoever clicks, so it is refused outright.
const COMPANY_CUSTOMER_TYPE = 'organization';
const namesCompanyCustomer = (body: unknown, query: unknown): boolean =>
  (body as { customerType?: unknown } | undefined)?.customerType === COMPANY_CUSTOMER_TYPE ||
  (query as { customerType?: unknown } | undefined)?.customerType === COMPANY_CUSTOMER_TYPE;

export async function canActOnCompanySubscription(
  { findCompanyRole, companyHoldsFounderGrid }: CompanyBillingAccess,
  userId: string,
  companyId: string,
  action: string,
  body?: unknown,
  query?: unknown,
): Promise<boolean> {
  if (!namesCompanyCustomer(body, query)) return false;
  if (isFounderCheckout(action, body) && !(await companyHoldsFounderGrid(companyId))) return false;
  const role = await findCompanyRole(userId, companyId);
  if (role === null) return false;
  return READ_ONLY_ACTIONS.has(action) || BILLING_MANAGERS.has(role);
}

// Every plugin hook that reports a subscription's state, mapped onto the company row
// (`stripe-subscription-sync.ts`). `onSubscriptionCancel` is left out: a pending cancel is still paid,
// and the `updated` event behind it already reaches `onSubscriptionUpdate`. A hook's error is caught
// and logged by the plugin, never retried by Stripe; the next event for the subscription re-sends the
// whole state, so a missed write is repaired by the following one.
const sync = async (data: StripeSubscriptionHookData) => {
  await syncStripeSubscription(data);
};
export const subscriptionSyncHooks = {
  onSubscriptionComplete: sync,
  onSubscriptionCreated: sync,
  onSubscriptionUpdate: sync,
  onSubscriptionDeleted: sync,
};

export function buildStripePlugin(
  { findCompanyRole, companyHoldsFounderGrid, findCompanyCustomerDetails }: StripePluginDeps,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isBillingEnabled(env)) return null;
  assertStripeEnvConfiguredForBoot(env);
  const plans = buildStripePlans(readStripePriceCatalog(env));

  return stripe({
    // The plugin types the ESM build of `stripe`; this CommonJS backend resolves the CJS one.
    stripeClient: stripeClientFor(env) as unknown as StripePluginOptions['stripeClient'],
    stripeWebhookSecret: (env.STRIPE_WEBHOOK_SECRET ?? '').trim(),
    createCustomerOnSignUp: false,
    // Each company has its own Stripe customer, stored on `Company.stripeCustomerId`: the plugin's
    // organization customer type with its `organization` model mapped onto the Company table. The
    // better-auth organization plugin is not used (Invoicerr has its own companies and roles), so the
    // plugin logs "Organization plugin not found" once at boot and skips only the member and name
    // sync hooks that plugin would carry; seats stay the quantity the company buys.
    organization: {
      enabled: true,
      getCustomerCreateParams: async (company) => {
        const details = await findCompanyCustomerDetails(company.id);
        return details ? { name: details.name, email: details.email } : {};
      },
    },
    schema: { organization: { modelName: 'company' } },
    subscription: {
      enabled: true,
      plans,
      authorizeReference: ({ user, referenceId, action }, ctx) =>
        canActOnCompanySubscription(
          { findCompanyRole, companyHoldsFounderGrid },
          user.id,
          referenceId,
          action,
          ctx?.body,
          ctx?.query,
        ),
      ...subscriptionSyncHooks,
    },
  });
}
