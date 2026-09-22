import { BILLING_FLAG_NAME } from './billing-flag';
import {
  assertPolarEnvConfiguredForBoot,
  findMissingPolarEnv,
  polarEnvMissingMessage,
  resolvePolarServerEnvironment,
} from './polar-env';

const FULL_ENV = {
  POLAR_ACCESS_TOKEN: 'polar_at_x',
  POLAR_WEBHOOK_SECRET: 'whsec_x',
  POLAR_ORGANIZATION_ID: 'org_x',
  POLAR_PRODUCT_ID_MONTHLY: 'prod_month',
  POLAR_PRODUCT_ID_YEARLY: 'prod_year',
};

const ENABLED_FULL_ENV = { ...FULL_ENV, [BILLING_FLAG_NAME]: 'true' };

describe('findMissingPolarEnv', () => {
  it('finds nothing when every required var is set', () => {
    expect(findMissingPolarEnv(FULL_ENV)).toEqual([]);
  });

  it('reports every missing var, in the declared order', () => {
    expect(findMissingPolarEnv({})).toEqual([
      'POLAR_ACCESS_TOKEN',
      'POLAR_WEBHOOK_SECRET',
      'POLAR_ORGANIZATION_ID',
      'POLAR_PRODUCT_ID_MONTHLY',
      'POLAR_PRODUCT_ID_YEARLY',
    ]);
  });

  it('treats a blank/whitespace-only value the same as unset', () => {
    expect(findMissingPolarEnv({ ...FULL_ENV, POLAR_ACCESS_TOKEN: '   ' })).toEqual(['POLAR_ACCESS_TOKEN']);
  });

  it('never requires POLAR_SERVER — it has a safe default', () => {
    expect(findMissingPolarEnv(FULL_ENV)).toEqual([]);
  });
});

describe('assertPolarEnvConfiguredForBoot', () => {
  it('is a no-op when billing is disabled, however incomplete the Polar vars are', () => {
    expect(() => assertPolarEnvConfiguredForBoot({})).not.toThrow();
    expect(() => assertPolarEnvConfiguredForBoot({ POLAR_ACCESS_TOKEN: 'x' })).not.toThrow();
  });

  it('does not throw when billing is enabled and everything is set', () => {
    expect(() => assertPolarEnvConfiguredForBoot(ENABLED_FULL_ENV)).not.toThrow();
  });

  it('throws, naming every missing var, when billing is enabled and anything is missing', () => {
    expect(() =>
      assertPolarEnvConfiguredForBoot({ [BILLING_FLAG_NAME]: 'true', POLAR_ACCESS_TOKEN: 'x' }),
    ).toThrow(/POLAR_WEBHOOK_SECRET/);
  });
});

describe('polarEnvMissingMessage', () => {
  it('names every missing variable', () => {
    const message = polarEnvMissingMessage(['POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET']);
    expect(message).toContain('POLAR_ACCESS_TOKEN');
    expect(message).toContain('POLAR_WEBHOOK_SECRET');
  });
});

describe('resolvePolarServerEnvironment', () => {
  it('defaults to sandbox when unset', () => {
    expect(resolvePolarServerEnvironment({})).toBe('sandbox');
  });

  it('is sandbox for anything other than the literal "production"', () => {
    expect(resolvePolarServerEnvironment({ POLAR_SERVER: 'prod' })).toBe('sandbox');
    expect(resolvePolarServerEnvironment({ POLAR_SERVER: 'Production' })).toBe('sandbox');
  });

  it('is production only for the exact literal', () => {
    expect(resolvePolarServerEnvironment({ POLAR_SERVER: 'production' })).toBe('production');
  });
});
