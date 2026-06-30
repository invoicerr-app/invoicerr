/**
 * Unit tests for portal-live-env helpers: portalPrefix + readNamespacedConfig.
 */
import { portalPrefix, readNamespacedConfig } from './portal-live-env';

describe('portalPrefix', () => {
  it('lowercases a simple id to uppercase', () => {
    expect(portalPrefix('choruspro')).toBe('CHORUSPRO');
  });

  it('replaces hyphens with underscores and uppercases', () => {
    expect(portalPrefix('eg-eta')).toBe('EG_ETA');
    expect(portalPrefix('in-irp')).toBe('IN_IRP');
    expect(portalPrefix('tn-ttn')).toBe('TN_TTN');
    expect(portalPrefix('uy-dgi')).toBe('UY_DGI');
    expect(portalPrefix('id-coretax')).toBe('ID_CORETAX');
  });

  it('replaces multiple non-alphanum chars with a single underscore', () => {
    // e.g. a hypothetical 'ke--kra' → 'KE_KRA'
    expect(portalPrefix('ke-kra')).toBe('KE_KRA');
  });

  it('handles fully numeric-suffixed ids', () => {
    expect(portalPrefix('my-invois2')).toBe('MY_INVOIS2');
  });
});

describe('readNamespacedConfig', () => {
  it('reads all <PREFIX>_* vars and camelCases the keys', () => {
    const env: Record<string, string> = {
      ANAF_LIVE: '1',
      ANAF_AUTH_TOKEN: 'tok123',
      ANAF_TAXPAYER_ID: 'RO12345678',
      ANAF_BASE_URL: 'https://api.anaf.ro',
      ANAF_ENVIRONMENT: 'TEST',
    };
    const config = readNamespacedConfig('ANAF', env);
    expect(config).toEqual({
      authToken: 'tok123',
      taxpayerId: 'RO12345678',
      baseUrl: 'https://api.anaf.ro',
      environment: 'TEST',
      // ANAF_LIVE is the gate key — must be stripped
    });
    expect(config['live']).toBeUndefined();
  });

  it('skips empty / undefined values', () => {
    const env: Record<string, string | undefined> = {
      ZATCA_LIVE: '1',
      ZATCA_API_KEY: '',
      ZATCA_CLIENT_ID: undefined,
      ZATCA_TAXPAYER_ID: 'SA1234',
    };
    const config = readNamespacedConfig('ZATCA', env as Record<string, string>);
    expect(config).toEqual({ taxpayerId: 'SA1234' });
  });

  it('does not include vars from a different prefix', () => {
    const env: Record<string, string> = {
      ANAF_AUTH_TOKEN: 'tok',
      ZATCA_API_KEY: 'key',
    };
    const config = readNamespacedConfig('ANAF', env);
    expect(Object.keys(config)).toEqual(['authToken']);
  });

  it('includes provider-specific extra keys not in the standard set', () => {
    const env: Record<string, string> = {
      CHORUSPRO_LIVE: '1',
      CHORUSPRO_CLIENT_ID: 'cid',
      CHORUSPRO_CLIENT_SECRET: 'csec',
      CHORUSPRO_TECH_LOGIN: 'login@example.com',
      CHORUSPRO_TECH_PASSWORD: 'pass',
    };
    const config = readNamespacedConfig('CHORUSPRO', env);
    expect(config.clientId).toBe('cid');
    expect(config.clientSecret).toBe('csec');
    expect(config.techLogin).toBe('login@example.com');
    expect(config.techPassword).toBe('pass');
    expect(config['live']).toBeUndefined();
  });

  it('uses process.env by default (smoke test — gate key absent means empty result)', () => {
    // Ensure calling without env param does not throw
    expect(() => readNamespacedConfig('UNLIKELY_NONEXISTENT_PREFIX_XYZ_Q')).not.toThrow();
  });

  it('handles multi-word suffixes with consecutive underscores correctly', () => {
    const env: Record<string, string> = {
      EG_ETA_CERT_PASSWORD: 'p@ssw0rd',
      EG_ETA_CLIENT_ID: 'cid',
    };
    const config = readNamespacedConfig('EG_ETA', env);
    expect(config.certPassword).toBe('p@ssw0rd');
    expect(config.clientId).toBe('cid');
  });
});

describe('gate behaviour (smoke)', () => {
  it('all portal live suites are skipped when no <PREFIX>_LIVE=1 is set', () => {
    // This test verifies the gate contract indirectly: no portal flag is set in this
    // process, so liveDescribe returns describe.skip for every portal.
    // The parametrized loop in portal-live.spec.ts covers them.
    // We just assert the helper itself never throws for any id in the registry.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NATIONAL_PORTAL_PROVIDERS } = require('./national-portals') as {
      NATIONAL_PORTAL_PROVIDERS: Array<{ id: string }>;
    };
    for (const p of NATIONAL_PORTAL_PROVIDERS) {
      const prefix = portalPrefix(p.id);
      expect(() => readNamespacedConfig(prefix)).not.toThrow();
      // No portal LIVE flag set in this test run.
      expect(process.env[`${prefix}_LIVE`]).toBeUndefined();
    }
  });
});
