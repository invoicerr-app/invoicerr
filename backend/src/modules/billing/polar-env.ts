/**
 * Boot-time guard for the Polar env vars. Takes `env` as a parameter so specs can drive it. Gated on
 * `isBillingEnabled(env)` rather than `NODE_ENV`, so a self-hosted instance without the billing flag
 * never needs any of these vars.
 */
import { isBillingEnabled } from './billing-flag';

const REQUIRED_VARS = [
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_ORGANIZATION_ID',
  'POLAR_PRODUCT_ID_MONTHLY',
  'POLAR_PRODUCT_ID_YEARLY',
] as const;

export type RequiredPolarVar = (typeof REQUIRED_VARS)[number];

const blank = (raw: string | undefined): boolean => (raw ?? '').trim().length === 0;

/** `POLAR_SERVER` is not required: a missing value falls back to the safer 'sandbox'. */
export function findMissingPolarEnv(env: NodeJS.ProcessEnv = process.env): RequiredPolarVar[] {
  return REQUIRED_VARS.filter((name) => blank(env[name]));
}

export function polarEnvMissingMessage(missing: RequiredPolarVar[]): string {
  return (
    '[billing] Refusing to boot: WARNING__ENABLE_BILLING_FOR_USERS__WARNING is set but ' +
    `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not configured. The hosted-billing ` +
    'system needs a real Polar organization access token, webhook secret, organization id, and both ' +
    'product ids (POLAR_PRODUCT_ID_MONTHLY, POLAR_PRODUCT_ID_YEARLY) to do anything — unset the flag ' +
    'to run self-hosted without billing, or set every one of these first. See .env.example.'
  );
}

/** A no-op when billing is disabled, so `main.ts` can call it unconditionally. */
export function assertPolarEnvConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (!isBillingEnabled(env)) return;
  const missing = findMissingPolarEnv(env);
  if (missing.length > 0) {
    throw new Error(polarEnvMissingMessage(missing));
  }
}

export type PolarServerEnvironment = 'sandbox' | 'production';

/** Defaults to 'sandbox' so a forgotten var can never charge real cards; anything other than the
 *  literal 'production' (including a typo) reads as 'sandbox'. */
export function resolvePolarServerEnvironment(env: NodeJS.ProcessEnv = process.env): PolarServerEnvironment {
  return env.POLAR_SERVER === 'production' ? 'production' : 'sandbox';
}
