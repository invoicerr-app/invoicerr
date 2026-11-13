import { isBillingEnabled } from './billing-flag';

const REQUIRED_VARS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

export type RequiredStripeVar = (typeof REQUIRED_VARS)[number];

const TEST_KEY = /^(sk|rk)_test_/;

const value = (env: NodeJS.ProcessEnv, name: string): string => (env[name] ?? '').trim();

export function isStripeLiveModeAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return value(env, 'STRIPE_MODE') === 'live';
}

export function findStripeEnvProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems = REQUIRED_VARS.filter((name) => value(env, name) === '').map(
    (name) => `${name} is not set`,
  );
  const key = value(env, 'STRIPE_SECRET_KEY');
  if (key !== '' && !TEST_KEY.test(key) && !isStripeLiveModeAllowed(env)) {
    problems.push('STRIPE_SECRET_KEY is not a test mode key and STRIPE_MODE is not "live"');
  }
  return problems;
}

export function assertStripeEnvConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (!isBillingEnabled(env)) return;
  const problems = findStripeEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `[billing] Refusing to boot: billing is enabled but the Stripe configuration is invalid:\n- ${problems.join('\n- ')}\nSee .env.example.`,
    );
  }
}
