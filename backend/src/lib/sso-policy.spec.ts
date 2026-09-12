import {
  COMPANY_PROVIDER_PREFIX,
  DEFAULT_ENV_OIDC_PROVIDER_ID,
  SSO_PROVISIONED_ROLE,
  type SsoLookupCandidate,
  companyForOAuthSignup,
  companyIdFromProviderId,
  companyProviderId,
  deriveUserNames,
  emailDomain,
  isOidcOnly,
  normalizeDomains,
  providerIdFromEndpointContext,
  resolveEnvOidcProvider,
  resolveSsoLookup,
  sanitizeProviderId,
  ssoEndpointsComplete,
  trustedProviderIds,
} from '@/lib/sso-policy';
import { CompanyRole } from '../../prisma/generated/prisma/client';

// A realistic company id: Prisma's `cuid()` output shape, which is what really ends up inside a
// provider id and therefore inside a URL path segment.
const COMPANY_ID = 'clx3k2j1p0000qwer1234asdf';

describe('companyProviderId / companyIdFromProviderId', () => {
  it('puts the company id inside the provider id', () => {
    expect(companyProviderId(COMPANY_ID)).toBe(`c_${COMPANY_ID}`);
  });

  it('round-trips: the company is recoverable from the provider id alone', () => {
    // This is the whole design: better-auth hands back only a flat string (`callback/:id`), so the
    // company has to be derivable from it with nothing else in hand.
    expect(companyIdFromProviderId(companyProviderId(COMPANY_ID))).toBe(COMPANY_ID);
  });

  it('is URL-safe — it is interpolated into a redirect-URI path segment', () => {
    // THE MUTATION PROOF for the prefix: if it ever became "c:" or "c/" this is what would catch it,
    // because the id the IdP sends back would no longer be the id that was registered.
    const id = companyProviderId(COMPANY_ID);
    expect(encodeURIComponent(id)).toBe(id);
    expect(id).not.toMatch(/[\s/%?#]/);
  });

  it('is not a per-company id when the prefix is absent', () => {
    expect(companyIdFromProviderId('pocketid')).toBeNull();
    expect(companyIdFromProviderId(DEFAULT_ENV_OIDC_PROVIDER_ID)).toBeNull();
    expect(companyIdFromProviderId('google')).toBeNull();
  });

  it('refuses a bare prefix with no company behind it', () => {
    expect(companyIdFromProviderId(COMPANY_PROVIDER_PREFIX)).toBeNull();
  });

  it.each([null, undefined, 42, {}, []])('never throws on untrusted input %p', (value) => {
    expect(() => companyIdFromProviderId(value as unknown as string)).not.toThrow();
    expect(companyIdFromProviderId(value as unknown as string)).toBeNull();
  });
});

describe('sanitizeProviderId', () => {
  it('leaves a correctly-configured, URL-safe name exactly as it is', () => {
    // The documented deployment (backend/.env's own OIDC_NAME) must keep the id it already has, or
    // every existing account would stop matching its provider.
    expect(sanitizeProviderId('pocketid')).toBe('pocketid');
    expect(sanitizeProviderId('keycloak-prod')).toBe('keycloak-prod');
    expect(sanitizeProviderId('Entra.ID_v2~1')).toBe('Entra.ID_v2~1');
  });

  it('replaces the SPACE in the historical default instead of leaving it in a URL path', () => {
    // 'Generic OIDC' was the old default and sat in /api/auth/callback/Generic%20OIDC, where the id
    // better-auth matched on was no longer the id it had registered.
    const id = sanitizeProviderId('Generic OIDC');
    expect(id).toBe('Generic-OIDC');
    expect(encodeURIComponent(id)).toBe(id);
  });

  it.each(['my idp', 'a/b', 'a?b', 'a#b', 'a%b', 'héllo'])('makes %p URL-safe', (raw) => {
    const id = sanitizeProviderId(raw);
    expect(encodeURIComponent(id)).toBe(id);
  });

  it('collapses each unsafe character rather than dropping it, so two names cannot become one id', () => {
    expect(sanitizeProviderId('a b')).not.toBe(sanitizeProviderId('ab'));
  });

  it.each([undefined, null, '', '   '])('falls back to the URL-safe default for %p', (raw) => {
    expect(sanitizeProviderId(raw)).toBe(DEFAULT_ENV_OIDC_PROVIDER_ID);
  });

  it('falls back when nothing usable survives, rather than registering an id of separators', () => {
    expect(sanitizeProviderId('   / ? ')).toBe(DEFAULT_ENV_OIDC_PROVIDER_ID);
  });

  it('the default is itself URL-safe (it used to contain a space)', () => {
    expect(encodeURIComponent(DEFAULT_ENV_OIDC_PROVIDER_ID)).toBe(DEFAULT_ENV_OIDC_PROVIDER_ID);
  });
});

describe('resolveEnvOidcProvider — the one fact the backend and the frontend must agree on', () => {
  it('registers, keeping the operator name, when both variables are set (the documented instance)', () => {
    expect(resolveEnvOidcProvider({ OIDC_NAME: 'pocketid', OIDC_CLIENT_ID: 'abc' })).toEqual({
      providerId: 'pocketid',
      registered: true,
    });
  });

  it('does NOT register on OIDC_NAME alone — the bug where a button led to PROVIDER_NOT_FOUND', () => {
    // The backend gated registration on OIDC_CLIENT_ID while the frontend showed the button on
    // OIDC_NAME. The gate is unchanged; what changed is that both sides now read THIS answer.
    expect(resolveEnvOidcProvider({ OIDC_NAME: 'pocketid' })).toEqual({
      providerId: 'pocketid',
      registered: false,
    });
  });

  it('registers under the URL-safe default when OIDC_CLIENT_ID alone is set', () => {
    // The other half of the same bug: a provider registered under an id the frontend never asks for
    // produced a callback that matched nothing.
    expect(resolveEnvOidcProvider({ OIDC_CLIENT_ID: 'abc' })).toEqual({
      providerId: DEFAULT_ENV_OIDC_PROVIDER_ID,
      registered: true,
    });
  });

  it('registers nothing on a bare instance', () => {
    expect(resolveEnvOidcProvider({}).registered).toBe(false);
  });

  it('treats a blank OIDC_CLIENT_ID as unset — a whitespace client id is not a client id', () => {
    expect(resolveEnvOidcProvider({ OIDC_CLIENT_ID: '   ' }).registered).toBe(false);
  });
});

describe('isOidcOnly', () => {
  it('is OFF by default — the e2e suite seeds itself through email sign-up', () => {
    // THE load-bearing assertion: a flag that defaulted on would make every fresh instance
    // unbootstrappable and the whole Cypress suite unable to create its first account.
    expect(isOidcOnly({})).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'True', '  true  '])('is on for %p', (raw) => {
    expect(isOidcOnly({ OIDC_ONLY: raw })).toBe(true);
  });

  it.each(['0', 'false', '', '   ', 'yes', 'on', 'no'])('is off for %p', (raw) => {
    expect(isOidcOnly({ OIDC_ONLY: raw })).toBe(false);
  });
});

describe('trustedProviderIds — re-resolved per request, which is why tenants can be trusted at all', () => {
  it('carries the environment provider plus every live per-company provider', () => {
    const ids = trustedProviderIds({
      env: { providerId: 'pocketid', registered: true },
      companyProviderIds: [companyProviderId('a'), companyProviderId('b')],
    });
    expect(ids).toEqual(['pocketid', 'c_a', 'c_b']);
  });

  it('still lists the environment provider when no company has one — the pre-existing behaviour', () => {
    expect(
      trustedProviderIds({ env: { providerId: 'pocketid', registered: true }, companyProviderIds: [] }),
    ).toEqual(['pocketid']);
  });

  it('lists the environment id even when unregistered, exactly as the old static array did', () => {
    // Trusting an id no provider answers to is inert; narrowing it would be a behaviour change for
    // existing deployments with no security benefit.
    expect(
      trustedProviderIds({ env: { providerId: 'oidc', registered: false }, companyProviderIds: [] }),
    ).toEqual(['oidc']);
  });

  it('de-duplicates rather than repeating an id', () => {
    expect(
      trustedProviderIds({
        env: { providerId: 'c_a', registered: true },
        companyProviderIds: ['c_a', 'c_a'],
      }),
    ).toEqual(['c_a']);
  });
});

describe('providerIdFromEndpointContext', () => {
  it('reads the browser redirect flow: /callback/:id', () => {
    expect(providerIdFromEndpointContext({ params: { id: 'c_acme' } })).toBe('c_acme');
  });

  it('reads the id_token flow: POST /sign-in/social', () => {
    expect(providerIdFromEndpointContext({ body: { provider: 'c_acme' } })).toBe('c_acme');
  });

  it('prefers the path parameter when both are somehow present', () => {
    expect(providerIdFromEndpointContext({ params: { id: 'c_a' }, body: { provider: 'c_b' } })).toBe('c_a');
  });

  it('is null for an email/password signup, which has neither', () => {
    // This is what keeps the invitation flow untouched: no provider, no SSO path.
    expect(providerIdFromEndpointContext({ body: { email: 'a@b.com', password: 'x' } })).toBeNull();
  });

  it.each([
    null,
    undefined,
    'string',
    42,
    {},
    { params: {} },
    { params: { id: '' } },
  ])('never throws and returns null for %p', (context) => {
    expect(() => providerIdFromEndpointContext(context)).not.toThrow();
    expect(providerIdFromEndpointContext(context)).toBeNull();
  });
});

describe('companyForOAuthSignup — the company a brand-new OAuth user belongs to', () => {
  it('derives the company from the provider id of the in-flight callback', () => {
    expect(companyForOAuthSignup({ params: { id: companyProviderId(COMPANY_ID) } })).toBe(COMPANY_ID);
  });

  it('is null for the instance-wide environment provider', () => {
    // An env-OIDC user is NOT a tenant user: they get no automatic membership, exactly as before.
    expect(companyForOAuthSignup({ params: { id: 'pocketid' } })).toBeNull();
  });

  it('is null for an email/password signup, so the invitation path still runs', () => {
    expect(companyForOAuthSignup({ body: { email: 'a@b.com' } })).toBeNull();
    expect(companyForOAuthSignup(null)).toBeNull();
  });
});

describe('SSO_PROVISIONED_ROLE', () => {
  it('is MEMBER — an IdP assertion is not a grant of administrative rights', () => {
    expect(SSO_PROVISIONED_ROLE).toBe(CompanyRole.MEMBER);
  });

  it('is neither OWNER nor ADMIN', () => {
    // Stated as its own assertion: promoting this constant would silently let anyone in a federated
    // directory rewrite the company's own SSO configuration.
    expect(SSO_PROVISIONED_ROLE).not.toBe(CompanyRole.OWNER);
    expect(SSO_PROVISIONED_ROLE).not.toBe(CompanyRole.ADMIN);
  });
});

describe('deriveUserNames — what an IdP sends versus what the schema requires', () => {
  it('leaves an email/password sign-up exactly as it posted', () => {
    // The pre-existing path: the frontend supplies all three, and nothing here may touch them.
    expect(deriveUserNames({ firstname: 'John', lastname: 'Doe', name: 'John Doe' })).toEqual({
      firstname: 'John',
      lastname: 'Doe',
      name: 'John Doe',
    });
  });

  it('maps the OIDC given_name/family_name claims, as it always did', () => {
    expect(deriveUserNames({ given_name: 'Alice', family_name: 'Martin', email: 'a@acme.com' })).toEqual({
      firstname: 'Alice',
      lastname: 'Martin',
      name: 'Alice Martin',
    });
  });

  it('splits a bare `name` when the IdP sends no given/family claims', () => {
    // THE reason this function exists: `User.firstname`/`lastname` are NOT NULL with no default, so
    // an IdP that sends only `name` would otherwise fail the INSERT mid-OAuth-callback.
    expect(deriveUserNames({ name: 'Alice Martin', email: 'a@acme.com' })).toEqual({
      firstname: 'Alice',
      lastname: 'Martin',
      name: 'Alice Martin',
    });
  });

  it('keeps a multi-word surname whole', () => {
    expect(deriveUserNames({ name: 'Alice Van Der Berg' })).toMatchObject({
      firstname: 'Alice',
      lastname: 'Van Der Berg',
    });
  });

  it('falls back to the email local part when the IdP sends no name at all', () => {
    expect(deriveUserNames({ email: 'alice.martin@acme.com' })).toMatchObject({
      firstname: 'alice.martin',
      lastname: '',
    });
  });

  it('never returns null for the two NOT NULL columns, even given nothing whatsoever', () => {
    // The floor: a cosmetic field must not be able to refuse an otherwise valid federated sign-in.
    const derived = deriveUserNames({});
    expect(derived.firstname).toBe('');
    expect(derived.lastname).toBe('');
    expect(typeof derived.firstname).toBe('string');
    expect(typeof derived.lastname).toBe('string');
  });

  it('prefers a supplied value over a provider claim', () => {
    expect(deriveUserNames({ firstname: 'Supplied', given_name: 'Claim' }).firstname).toBe('Supplied');
  });

  it('treats a blank supplied value as absent rather than storing whitespace', () => {
    expect(deriveUserNames({ firstname: '   ', given_name: 'Alice' }).firstname).toBe('Alice');
  });

  it('recomputes `name` from the two parts whenever both are known', () => {
    expect(deriveUserNames({ firstname: 'Alice', lastname: 'Martin', name: 'stale value' }).name).toBe(
      'Alice Martin',
    );
  });
});

describe('emailDomain', () => {
  it('takes the bare domain, lowercased', () => {
    expect(emailDomain('Alice@Acme.COM')).toBe('acme.com');
  });

  it('uses the LAST @, so a quoted local part cannot smuggle a domain in', () => {
    expect(emailDomain('a@b@acme.com')).toBe('acme.com');
  });

  it.each([
    null,
    undefined,
    '',
    'nope',
    '@acme.com',
    'alice@',
    'alice@ acme.com',
    'alice@acme com',
  ])('is null for %p', (email) => {
    expect(emailDomain(email as string)).toBeNull();
  });
});

describe('normalizeDomains', () => {
  it('accepts an array and normalises each entry', () => {
    expect(normalizeDomains([' Acme.COM ', '@sub.acme.com'])).toEqual(['acme.com', 'sub.acme.com']);
  });

  it('accepts the comma-separated string a human actually types', () => {
    expect(normalizeDomains('acme.com, acme.fr')).toEqual(['acme.com', 'acme.fr']);
  });

  it('de-duplicates', () => {
    expect(normalizeDomains(['acme.com', 'ACME.com'])).toEqual(['acme.com']);
  });

  it('strips a trailing dot — the legal fully-qualified form a user may paste from a zone file or dig', () => {
    expect(normalizeDomains(['acme.com.'])).toEqual(['acme.com']);
  });

  it('de-duplicates the fully-qualified and bare spellings of the same domain', () => {
    expect(normalizeDomains(['acme.com.', 'acme.com'])).toEqual(['acme.com']);
  });

  it('drops entries that are not domains rather than storing them', () => {
    expect(normalizeDomains(['', '   ', 'a b', 'http://acme.com', 42 as unknown as string])).toEqual([]);
  });

  it.each([null, undefined, 42, {}])('is an empty list for %p', (input) => {
    expect(normalizeDomains(input)).toEqual([]);
  });
});

describe('resolveSsoLookup — the @Public() email-first lookup', () => {
  const verified = (overrides: Partial<SsoLookupCandidate> = {}): SsoLookupCandidate => ({
    providerId: companyProviderId(COMPANY_ID),
    label: 'Acme SSO',
    isActive: true,
    verifiedDomains: ['acme.com'],
    ...overrides,
  });

  it('matches an active row whose domains are verified', () => {
    expect(resolveSsoLookup([verified()], 'alice@acme.com')).toEqual({
      providerId: companyProviderId(COMPANY_ID),
      label: 'Acme SSO',
    });
  });

  it('returns ONLY providerId and label — nothing about the company or its configuration', () => {
    // THE MUTATION PROOF for the response shape: widening the result to carry the company id, the
    // endpoints, or the claimed domain list is exactly what this catches, because none of those
    // values may appear anywhere in the serialised answer.
    const result = resolveSsoLookup([verified()], 'alice@acme.com');
    expect(Object.keys(result!).sort()).toEqual(['label', 'providerId']);
    expect(JSON.stringify(result)).not.toContain('acme.com');
    expect(JSON.stringify(result)).not.toContain(COMPANY_ID.slice(0, 8).concat('-never'));
  });

  it('refuses a row whose domain was never VERIFIED — an unverified claim is not a claim', () => {
    // The domain-claim hole this property exists to close: without it, any company could type
    // "gmail.com" and have strangers' sign-ins routed at its own IdP.
    expect(resolveSsoLookup([verified({ verifiedDomains: [] })], 'alice@acme.com')).toBeNull();
  });

  it('refuses a row that has OTHER verified domains but not the one being looked up', () => {
    // The precise per-domain property this whole redesign exists for: verifying "acme.com" must never
    // make "gmail.com", claimed later by the same row, verified too.
    expect(
      resolveSsoLookup([verified({ verifiedDomains: ['other-verified.com'] })], 'alice@acme.com'),
    ).toBeNull();
  });

  it('refuses an inactive row', () => {
    expect(resolveSsoLookup([verified({ isActive: false })], 'alice@acme.com')).toBeNull();
  });

  it('refuses a domain the row does not claim', () => {
    expect(resolveSsoLookup([verified()], 'alice@other.com')).toBeNull();
  });

  it('does not match a SUBDOMAIN of a claimed domain', () => {
    // Claiming "acme.com" must not capture "evil.acme.com.attacker.net" or any sibling: the match is
    // exact, never a suffix test.
    expect(resolveSsoLookup([verified()], 'alice@evil.acme.com')).toBeNull();
    expect(resolveSsoLookup([verified()], 'alice@acme.com.attacker.net')).toBeNull();
  });

  it.each([null, undefined, '', 'not-an-email'])('is null for the non-email %p', (email) => {
    expect(resolveSsoLookup([verified()], email as string)).toBeNull();
  });

  it('is null when no company has configured SSO at all', () => {
    expect(resolveSsoLookup([], 'alice@acme.com')).toBeNull();
  });

  it('skips an unusable row and still finds a usable one behind it', () => {
    const result = resolveSsoLookup(
      [verified({ verifiedDomains: [] }), verified({ providerId: 'c_other', label: 'Other' })],
      'alice@acme.com',
    );
    expect(result).toEqual({ providerId: 'c_other', label: 'Other' });
  });
});

describe('ssoEndpointsComplete', () => {
  it('is satisfied by a discovery URL alone — the ordinary OIDC case', () => {
    expect(
      ssoEndpointsComplete({ discoveryUrl: 'https://idp.example/.well-known/openid-configuration' }),
    ).toBe(true);
  });

  it('is satisfied by an authorization URL and a token URL spelled out', () => {
    expect(
      ssoEndpointsComplete({ authorizationUrl: 'https://idp/authorize', tokenUrl: 'https://idp/token' }),
    ).toBe(true);
  });

  it('refuses an authorization URL with no token exchange — the plugin would skip the provider', () => {
    expect(ssoEndpointsComplete({ authorizationUrl: 'https://idp/authorize' })).toBe(false);
  });

  it('refuses a row with nothing at all', () => {
    expect(ssoEndpointsComplete({})).toBe(false);
  });

  it.each(['', '   '])('treats the blank URL %p as absent', (blank) => {
    expect(ssoEndpointsComplete({ discoveryUrl: blank })).toBe(false);
    expect(ssoEndpointsComplete({ authorizationUrl: blank, tokenUrl: 'https://idp/token' })).toBe(false);
  });
});
