/**
 * Boot-time guard for the Polar env vars — same spirit as `lib/secret-guard.ts`'s own
 * `findInsecureSecret`/`assertSecretsConfiguredForBoot`: pure, never reads `process.env` itself
 * (takes it as a parameter) so a spec can drive it cold, and the throwing wrapper is what a real
 * boot site calls.
 *
 * UNLIKE `secret-guard.ts` this is NOT gated to `NODE_ENV === 'production'` — it is gated to
 * `isBillingEnabled(env)` instead, checked INSIDE `assertPolarEnvConfiguredForBoot` itself (the same
 * "the guard owns its own gate" shape `sso-policy.ts#assertOidcOnlyHasProvider` already holds for
 * `OIDC_ONLY`), so `main.ts` can call it UNCONDITIONALLY, right next to
 * `assertSecretsConfiguredForBoot`, without an extra `if` at the call site to get wrong. A
 * self-hosted instance that never sets the billing flag is never affected by this guard at all —
 * every env var it names stays fully optional for it.
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

/** `POLAR_SERVER` is not in `REQUIRED_VARS` above — it has a safe, explicit default ('sandbox', see
 *  `polar-plugin.ts`) rather than a missing-credential failure mode, so a deployment that forgets it
 *  gets the SAFER environment rather than a refused boot. */
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

/** Throws a named, explicit error when billing is enabled but the credentials it needs are not; a
 *  no-op (never even inspects `REQUIRED_VARS`) when `isBillingEnabled(env)` is false — see this
 *  file's own header for why the gate lives HERE rather than at every call site. */
export function assertPolarEnvConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (!isBillingEnabled(env)) return;
  const missing = findMissingPolarEnv(env);
  if (missing.length > 0) {
    throw new Error(polarEnvMissingMessage(missing));
  }
}

export type PolarServerEnvironment = 'sandbox' | 'production';

/** `POLAR_SERVER` — defaults to 'sandbox' (the SAFER default: sandbox access tokens are entirely
 *  separate from production ones per Polar's own docs, so a deployment that forgets this var can
 *  never accidentally start charging real cards). Any value other than the literal 'production'
 *  reads as 'sandbox', deliberately (a typo must never silently promote to production). */
export function resolvePolarServerEnvironment(env: NodeJS.ProcessEnv = process.env): PolarServerEnvironment {
  return env.POLAR_SERVER === 'production' ? 'production' : 'sandbox';
}
