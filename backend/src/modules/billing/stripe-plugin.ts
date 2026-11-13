import { stripe } from '@better-auth/stripe';
import Stripe from 'stripe';
import { isBillingEnabled } from './billing-flag';
import { assertStripeEnvConfiguredForBoot } from './stripe-env';

type StripePluginOptions = Parameters<typeof stripe>[0];

export type CompanyBillingRole = 'OWNER' | 'ADMIN' | 'MEMBER' | string;

export type FindCompanyRole = (userId: string, companyId: string) => Promise<CompanyBillingRole | null>;

const READ_ONLY_ACTIONS = new Set(['list-subscription']);
const BILLING_MANAGERS = new Set(['OWNER', 'ADMIN']);

export async function canActOnCompanySubscription(
  findCompanyRole: FindCompanyRole,
  userId: string,
  companyId: string,
  action: string,
): Promise<boolean> {
  const role = await findCompanyRole(userId, companyId);
  if (role === null) return false;
  return READ_ONLY_ACTIONS.has(action) || BILLING_MANAGERS.has(role);
}

export function buildStripePlugin(findCompanyRole: FindCompanyRole, env: NodeJS.ProcessEnv = process.env) {
  if (!isBillingEnabled(env)) return null;
  assertStripeEnvConfiguredForBoot(env);

  return stripe({
    // The plugin types the ESM build of `stripe`; this CommonJS backend resolves the CJS one.
    stripeClient: new Stripe(
      (env.STRIPE_SECRET_KEY ?? '').trim(),
    ) as unknown as StripePluginOptions['stripeClient'],
    stripeWebhookSecret: (env.STRIPE_WEBHOOK_SECRET ?? '').trim(),
    createCustomerOnSignUp: false,
    subscription: {
      enabled: true,
      plans: [],
      authorizeReference: ({ user, referenceId, action }) =>
        canActOnCompanySubscription(findCompanyRole, user.id, referenceId, action),
    },
  });
}
