/**
 * DEMO_MODE: the ONE switch that turns this instance into a public demo (issue #533). Off by
 * default, the same "pure, synchronous, env passed as a parameter" shape
 * `billing/billing-flag.ts#isBillingEnabled` already holds. Callable from a plain script
 * (`scripts/demo-reset.ts`, no Nest DI) and from `lib/auth.ts` at module load time, and trivially
 * testable both ways without mocking `process.env`.
 *
 * NEVER set this on a real, self-hosted install. Turning it on:
 *  - blocks every outbound send this instance can make (e-mail, every e-invoicing transport, outbound
 *    webhooks, tax-authority declarations, payment-provider checkout sessions, every Polar call) at
 *    the lowest shared chokepoint each one has; see `demo-blocked.ts`'s own header for the full list
 *    and why each chokepoint was chosen;
 *  - forces billing off outright, regardless of `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`; see
 *    `billing/billing-flag.ts#isBillingEnabled`'s own demo-mode branch;
 *  - refuses to let the demo account's e-mail or password be changed, the account or its company be
 *    deleted, a new account be registered, an API key be created, or SSO be configured; see
 *    `lib/registration-policy.ts`, `lib/auth.ts`'s `hooks.before`/`deleteUser.beforeDelete`, and
 *    `guards/demo-restricted.guard.ts`.
 */
export const DEMO_MODE_FLAG_NAME = 'DEMO_MODE';

/** The one account a demo instance ever seeds and shows on its own sign-in page. An ordinary
 *  self-hosted install with DEMO_MODE unset never reads this constant at all. */
export const DEMO_ACCOUNT_EMAIL = 'demo@invoicerr.app';
export const DEMO_ACCOUNT_PASSWORD = 'demo';

export function isDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[DEMO_MODE_FLAG_NAME] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * Set ONLY by `scripts/demo-reset.ts`, in its OWN short-lived process, before it does anything else.
 * Never read anywhere outside `lib/registration-policy.ts#decideRegistration`'s own demo-mode branch,
 * and never reachable from an HTTP request: the live API/worker process never sets this environment
 * variable, so every OTHER demo-mode refusal in this codebase stays unconditional for every real
 * caller. Its one job is letting the reset script itself create the fixed `demo@invoicerr.app`
 * account server-side the first time it runs (through the real `auth.api.signUpEmail`, never a
 * hand-rolled password hash, see that script's own header) without also having to disable demo
 * mode's own sign-up refusal for every OTHER caller while it does.
 */
export const DEMO_SEED_BYPASS_FLAG_NAME = 'DEMO_SEED_RUN';

export function isDemoSeedBypassActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[DEMO_SEED_BYPASS_FLAG_NAME] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}
