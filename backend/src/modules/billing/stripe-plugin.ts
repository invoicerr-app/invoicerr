import { type StripePlan, stripe } from '@better-auth/stripe';
import Stripe from 'stripe';
import { isBillingEnabled } from './billing-flag';
import { assertStripeEnvConfiguredForBoot } from './stripe-env';
import { type PriceGrid, readStripePriceCatalog, type StripePriceCatalog } from './stripe-price-catalog';

type StripePluginOptions = Parameters<typeof stripe>[0];

export type CompanyBillingRole = 'OWNER' | 'ADMIN' | 'MEMBER' | string;

export type FindCompanyRole = (userId: string, companyId: string) => Promise<CompanyBillingRole | null>;

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

// The founder plan exists so a founder subscription resolves to a plan, but nobody can check out
// on it yet: who keeps the founder grid is decided per company in a later step (#971, slice 7).
const isFounderCheckout = (action: string, body: unknown): boolean =>
  action === 'upgrade-subscription' &&
  typeof (body as { plan?: unknown } | undefined)?.plan === 'string' &&
  (body as { plan: string }).plan.toLowerCase() === 'founder';

export async function canActOnCompanySubscription(
  findCompanyRole: FindCompanyRole,
  userId: string,
  companyId: string,
  action: string,
  body?: unknown,
): Promise<boolean> {
  if (isFounderCheckout(action, body)) return false;
  const role = await findCompanyRole(userId, companyId);
  if (role === null) return false;
  return READ_ONLY_ACTIONS.has(action) || BILLING_MANAGERS.has(role);
}

export function buildStripePlugin(findCompanyRole: FindCompanyRole, env: NodeJS.ProcessEnv = process.env) {
  if (!isBillingEnabled(env)) return null;
  assertStripeEnvConfiguredForBoot(env);
  const plans = buildStripePlans(readStripePriceCatalog(env));

  return stripe({
    // The plugin types the ESM build of `stripe`; this CommonJS backend resolves the CJS one.
    stripeClient: new Stripe(
      (env.STRIPE_SECRET_KEY ?? '').trim(),
    ) as unknown as StripePluginOptions['stripeClient'],
    stripeWebhookSecret: (env.STRIPE_WEBHOOK_SECRET ?? '').trim(),
    createCustomerOnSignUp: false,
    subscription: {
      enabled: true,
      plans,
      authorizeReference: ({ user, referenceId, action }, ctx) =>
        canActOnCompanySubscription(findCompanyRole, user.id, referenceId, action, ctx?.body),
    },
  });
}
