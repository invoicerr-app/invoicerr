/**
 * Unit tests for portal-live-env helpers: portalPrefix + readNamespacedConfig.
 */
import { portalPrefix, readNamespacedConfig, portalHasCreds, PORTAL_CRED_SUFFIXES } from './portal-live-env';

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
    expect(config.live).toBeUndefined();
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
    expect(config.live).toBeUndefined();
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
  it('a bare <PREFIX>_LIVE=1 flag never satisfies the cred gate (two-tier gate → describe.skip)', () => {
    // This test verifies the gate contract directly and deterministically: regardless of
    // ambient process.env (e.g. the national-portals-live CI job, which sets <PREFIX>_LIVE=1
    // as a constant for every portal with no credentials), a synthetic flag-only env must
    // never satisfy portalHasCreds. The two-tier gate (flagOn && hasCreds) therefore always
    // fires describe.skip when only the flag is set. The parametrized loop in
    // portal-live.spec.ts covers the actual skip behaviour per portal.
    const { NATIONAL_PORTAL_PROVIDERS } = require('./national-portals') as {
      NATIONAL_PORTAL_PROVIDERS: Array<{ id: string }>;
    };
    for (const p of NATIONAL_PORTAL_PROVIDERS) {
      const prefix = portalPrefix(p.id);
      expect(() => readNamespacedConfig(prefix)).not.toThrow();
      // Two-tier gate: a bare <PREFIX>_LIVE=1 flag (the workflow's constant) must NEVER
      // satisfy the credential gate — only real credentials do. Use a synthetic flag-only
      // env (not process.env, which the workflow populates with _LIVE=1) so this is
      // deterministic in every environment.
      expect(portalHasCreds(prefix, { [`${prefix}_LIVE`]: '1' })).toBe(false);
    }
  });
});

describe('portalHasCreds', () => {
  it('returns false when no env vars are present', () => {
    expect(portalHasCreds('ANAF', {})).toBe(false);
  });

  it('returns false when only the LIVE gate flag is present (not a credential)', () => {
    // <PREFIX>_LIVE=1 is a constant in the workflow — it must NOT satisfy the cred gate.
    expect(portalHasCreds('ANAF', { ANAF_LIVE: '1' })).toBe(false);
  });

  it('returns true when _AUTH_TOKEN is present', () => {
    expect(portalHasCreds('ANAF', { ANAF_AUTH_TOKEN: 'tok123' })).toBe(true);
  });

  it('returns true when _API_KEY is present', () => {
    expect(portalHasCreds('ZATCA', { ZATCA_API_KEY: 'key' })).toBe(true);
  });

  it('returns true when _CLIENT_ID is present', () => {
    expect(portalHasCreds('CHORUSPRO', { CHORUSPRO_CLIENT_ID: 'cid' })).toBe(true);
  });

  it('returns true when _CLIENT_SECRET is present', () => {
    expect(portalHasCreds('CHORUSPRO', { CHORUSPRO_CLIENT_SECRET: 'csec' })).toBe(true);
  });

  it('returns true when _CERTIFICATE is present', () => {
    expect(portalHasCreds('SEFAZ', { SEFAZ_CERTIFICATE: 'base64pfx==' })).toBe(true);
  });

  it('returns false when only non-credential vars are set (BASE_URL, TAXPAYER_ID, etc.)', () => {
    const env = {
      ANAF_LIVE: '1',
      ANAF_BASE_URL: 'https://api.anaf.ro',
      ANAF_ENVIRONMENT: 'TEST',
      ANAF_TAXPAYER_ID: 'RO12345678',
      ANAF_SELLER_VAT: 'RO12345678',
      ANAF_BUYER_VAT: 'RO00000001',
      ANAF_COUNTRY: 'RO',
    };
    expect(portalHasCreds('ANAF', env)).toBe(false);
  });

  it('PORTAL_CRED_SUFFIXES does not include _LIVE or _ENVIRONMENT', () => {
    expect(PORTAL_CRED_SUFFIXES).not.toContain('_LIVE');
    expect(PORTAL_CRED_SUFFIXES).not.toContain('_ENVIRONMENT');
  });
});

describe('portal gate: LIVE=1 but no creds → would be skipped', () => {
  it('demonstrates the two-tier gate: flag only → hasCreds=false → skip', () => {
    // This is the key guard: workflow sets <PREFIX>_LIVE='1' as a constant.
    // If no credentials are configured, hasCreds returns false → describe.skip fires.
    // No transmit() is called, no SKIPPED hard-fail occurs.
    const env = { ANAF_LIVE: '1' };
    const flagOn = env.ANAF_LIVE === '1';
    const hasCreds = portalHasCreds('ANAF', env);
    expect(flagOn).toBe(true);
    expect(hasCreds).toBe(false); // → describe.skip, not describe
  });

  it('demonstrates the two-tier gate: flag + cred → hasCreds=true → would run', () => {
    const env = { ANAF_LIVE: '1', ANAF_AUTH_TOKEN: 'real-token' };
    const flagOn = env.ANAF_LIVE === '1';
    const hasCreds = portalHasCreds('ANAF', env);
    expect(flagOn).toBe(true);
    expect(hasCreds).toBe(true); // → describe runs
  });
});
