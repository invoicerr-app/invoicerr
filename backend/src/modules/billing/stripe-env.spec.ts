import { BILLING_FLAG_NAME } from './billing-flag';
import {
  assertStripeEnvConfiguredForBoot,
  findStripeEnvProblems,
  isStripeLiveModeAllowed,
} from './stripe-env';

const TEST_ENV = { STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_abc' };

describe('findStripeEnvProblems', () => {
  it('accepts a test mode secret key with a webhook secret', () => {
    expect(findStripeEnvProblems(TEST_ENV)).toEqual([]);
  });

  it('accepts a restricted test mode key', () => {
    expect(findStripeEnvProblems({ ...TEST_ENV, STRIPE_SECRET_KEY: 'rk_test_abc' })).toEqual([]);
  });

  it('reports every missing variable, blank counting as missing', () => {
    expect(findStripeEnvProblems({ STRIPE_SECRET_KEY: ' ' })).toEqual([
      'STRIPE_SECRET_KEY is not set',
      'STRIPE_WEBHOOK_SECRET is not set',
    ]);
  });

  it('refuses a live key unless STRIPE_MODE is live', () => {
    const live = { ...TEST_ENV, STRIPE_SECRET_KEY: 'sk_live_abc' };
    expect(findStripeEnvProblems(live)).toEqual([
      'STRIPE_SECRET_KEY is not a test mode key and STRIPE_MODE is not "live"',
    ]);
    expect(findStripeEnvProblems({ ...live, STRIPE_MODE: 'live' })).toEqual([]);
  });

  it('reads any STRIPE_MODE other than the exact word live as test mode', () => {
    expect(isStripeLiveModeAllowed({ STRIPE_MODE: 'Live' })).toBe(false);
    expect(isStripeLiveModeAllowed({})).toBe(false);
  });
});

describe('assertStripeEnvConfiguredForBoot', () => {
  it('is a no-op while billing is disabled', () => {
    expect(() => assertStripeEnvConfiguredForBoot({})).not.toThrow();
  });

  it('throws with every problem when billing is enabled', () => {
    expect(() => assertStripeEnvConfiguredForBoot({ [BILLING_FLAG_NAME]: 'true' })).toThrow(
      /STRIPE_SECRET_KEY is not set[\s\S]*STRIPE_WEBHOOK_SECRET is not set/,
    );
  });

  it('passes when billing is enabled and configured', () => {
    expect(() =>
      assertStripeEnvConfiguredForBoot({ [BILLING_FLAG_NAME]: 'true', ...TEST_ENV }),
    ).not.toThrow();
  });
});
