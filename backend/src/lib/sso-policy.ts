/**
 * Shared, framework-agnostic decisions for OIDC single sign-on — both the instance-wide provider
 * configured from the environment and the per-company ones a customer registers for itself.
 *
 * This module exists for the same reason `lib/registration-policy.ts` does: the call sites cannot
 * share a DI container, and the most important one cannot be tested at all. `lib/auth.ts` builds a
 * live Prisma adapter at import time and pulls in `dotenv/config`, so merely importing it in a spec
 * would read the real `.env` and register the real environment provider (discovery URL included) —
 * which is why no spec in this repository imports it, and why anything decided inside it would be
 * untestable. The three call sites that need these answers are:
 *  - `lib/auth.ts` — which environment provider id to register, whether email/password stays
 *    enabled, which providers account linking may trust, and which company a brand-new OAuth user
 *    belongs to;
 *  - `modules/company/sso/sso.service.ts` — the Nest-injected service owning the stored rows;
 *  - `modules/company/sso/sso-registrar.service.ts` — boot-time and on-write registration.
 * Each resolves its own raw facts from its own client, then hands them to these pure functions, so
 * the decision lives in exactly one place instead of drifting between three copies.
 *
 * Nothing here reads `process.env` implicitly or throws: every function takes what it needs, so a
 * spec can drive it "cold" with synthetic inputs.
 */

import type { BetterAuthOptions, ValidateUserInfoResult } from 'better-auth';

import { CompanyRole } from '../../prisma/generated/prisma/client';

// ---------------------------------------------------------------------------
// The company lives IN the provider id
// ---------------------------------------------------------------------------

/**
 * Prefix marking a provider id as belonging to one company rather than to the instance.
 *
 * An underscore, not a colon or a slash: this string ends up as a single URL PATH SEGMENT
 * (/api/auth/callback/c_<companyId>), so it must survive a URL untouched and must not introduce a
 * path separator. Company ids are cuids (lowercase alphanumeric), so the whole id is URL-safe.
 */
export const COMPANY_PROVIDER_PREFIX = 'c_';

/** The better-auth provider id for one company's own IdP. */
export function companyProviderId(companyId: string): string {
  return `${COMPANY_PROVIDER_PREFIX}${companyId}`;
}

/**
 * The company a provider id belongs to, or null when the id is not a per-company one (the
 * environment provider, or a built-in social provider). Never throws on odd input — it is fed
 * untrusted strings straight off the wire (`callback/:id`).
 */
export function companyIdFromProviderId(providerId: string | null | undefined): string | null {
  if (typeof providerId !== 'string') return null;
  if (!providerId.startsWith(COMPANY_PROVIDER_PREFIX)) return null;
  const companyId = providerId.slice(COMPANY_PROVIDER_PREFIX.length);
  return companyId.length > 0 ? companyId : null;
}

// ---------------------------------------------------------------------------
// The instance-wide provider configured from the environment
// ---------------------------------------------------------------------------

/**
 * Characters a provider id may contain. Deliberately narrower than RFC 3986's `pchar`: a provider id
 * is interpolated into a URL path segment AND compared byte-for-byte against what the IdP sends
 * back, so anything that a proxy, a browser, or an IdP's own redirect-URI normaliser might re-encode
 * (a space, a slash, a percent) must never appear in one.
 */
const URL_SAFE_PROVIDER_ID = /[^A-Za-z0-9._~-]/g;

/**
 * Fallback provider id when `OIDC_NAME` is unset. "oidc" is not a new invention: it is already the
 * value the sign-in page falls back to (`frontend/src/pages/auth/sign-in.tsx`'s
 * `oidcProviderId || "oidc"`), so defaulting to it here is what makes the two sides agree.
 */
export const DEFAULT_ENV_OIDC_PROVIDER_ID = 'oidc';

/**
 * Coerce an operator-supplied provider name into something safe to put in a URL path segment.
 *
 * The historical default was `'Generic OIDC'` — which contains a SPACE, and then sat in
 * /api/auth/callback/Generic%20OIDC, where the id better-auth matches on (`c.params.id`) is no
 * longer the id it registered. Any character outside the safe set collapses to "-" rather than being
 * dropped, so two distinct names cannot silently become the same id.
 */
export function sanitizeProviderId(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return DEFAULT_ENV_OIDC_PROVIDER_ID;
  const safe = trimmed.replace(URL_SAFE_PROVIDER_ID, '-');
  // Nothing usable survived (a name made entirely of separators) — fall back rather than register a
  // provider whose id is "---".
  return /[A-Za-z0-9]/.test(safe) ? safe : DEFAULT_ENV_OIDC_PROVIDER_ID;
}

export interface EnvOidcProvider {
  /** The id actually registered with better-auth, and the one the frontend must ask for. */
  providerId: string;
  /** Whether this instance registers an environment provider at all. */
  registered: boolean;
}

/**
 * The environment provider's identity and whether it is registered — ONE answer, so the backend and
 * the frontend cannot disagree about it.
 *
 * Two real bugs are closed here, without changing anything for a correctly-configured instance:
 *  - The backend registered the plugin on `OIDC_CLIENT_ID` while the frontend showed the button on
 *    `OIDC_NAME`, so setting only one of them yielded either a PROVIDER_NOT_FOUND on sign-in or a
 *    button that led to a callback nothing matched. The gate stays exactly where it was —
 *    `OIDC_CLIENT_ID` decides — and `registered` is now the single fact both sides read, with
 *    `entrypoint.sh` publishing this same resolved id to the browser instead of the raw `OIDC_NAME`.
 *  - The default id contained a space (see `sanitizeProviderId`).
 * An instance that sets both variables with a URL-safe name (the documented case) keeps the exact id
 * it had.
 */
export function resolveEnvOidcProvider(env: NodeJS.ProcessEnv = process.env): EnvOidcProvider {
  return {
    providerId: sanitizeProviderId(env.OIDC_NAME),
    registered: Boolean((env.OIDC_CLIENT_ID ?? '').trim()),
  };
}

// ---------------------------------------------------------------------------
// The instance-wide provider's OIDC endpoints
// ---------------------------------------------------------------------------

/** The endpoint-related fields of better-auth's `GenericOAuthConfig` — see `resolveOidcEndpoints`. */
export interface OidcEndpointConfig {
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  endSessionEndpoint?: string;
}

/**
 * The endpoint half of `lib/auth.ts#createOidcConfig`, pulled out for the same reason
 * `resolveEnvOidcProvider` above is: `lib/auth.ts` cannot be imported from a spec at all (see this
 * module's own header), so anything in it worth unit-testing has to live here instead.
 *
 * Discovery wins over the three manual endpoints, never both: `OIDC_DISCOVERY_URL` (or its legacy
 * alias, below) is checked FIRST, and when it is present the manual `OIDC_*_ENDPOINT` variables are
 * never even read — matching `.env.example`'s own "pick ONE of the two options" instruction.
 *
 * `OIDC_DISCOVERY_URL` is the current name; `OIDC_JWKS_URI` is kept working as a backward-compatibility
 * alias, exactly the way `rendering/render-pdf.ts`'s `resolveChromiumExecutablePath` keeps honouring
 * `PUPPETEER_EXECUTABLE_PATH` after the engine it named was swapped. The old name was actively
 * misleading — this value is fetched as an OpenID discovery DOCUMENT (better-auth's `discoveryUrl`),
 * never a JWKS — and the shipped example once pointed it at a bare `jwks.json`, which silently
 * disabled OIDC rather than erroring. Renaming it must not break an operator who already set the old
 * name, so it keeps being honoured for as long as `OIDC_JWKS_URI` might still appear in someone's env.
 *
 * `OIDC_END_SESSION_ENDPOINT` powers RP-Initiated Logout: better-auth's generic-OAuth plugin only
 * builds a provider logout URL (`createEndSessionURL`, called from its own `/sign-out` route for every
 * linked account whose provider defines one) when this field is set. Without it, better-auth's
 * sign-out clears the LOCAL session only — silently, with no error — and never logs the user out at
 * the identity provider.
 */
export function resolveOidcEndpoints(env: NodeJS.ProcessEnv = process.env): OidcEndpointConfig {
  const config: OidcEndpointConfig = {};

  // The current name wins over the legacy alias if, somehow, both were ever set at once — `.env.example`
  // never shows both uncommented together, so this ordering is not expected to matter in practice.
  const discoveryUrl = env.OIDC_DISCOVERY_URL || env.OIDC_JWKS_URI;
  if (discoveryUrl) {
    config.discoveryUrl = discoveryUrl;
  } else {
    if (env.OIDC_AUTHORIZATION_ENDPOINT) config.authorizationUrl = env.OIDC_AUTHORIZATION_ENDPOINT;
    if (env.OIDC_TOKEN_ENDPOINT) config.tokenUrl = env.OIDC_TOKEN_ENDPOINT;
    if (env.OIDC_USERINFO_ENDPOINT) config.userInfoUrl = env.OIDC_USERINFO_ENDPOINT;
  }

  if (env.OIDC_END_SESSION_ENDPOINT) {
    config.endSessionEndpoint = env.OIDC_END_SESSION_ENDPOINT;
  }

  return config;
}

// ---------------------------------------------------------------------------
// OIDC_ONLY — instance-wide, default OFF
// ---------------------------------------------------------------------------

/**
 * Whether this instance accepts ONLY single sign-on (no email/password at all).
 *
 * DEFAULT OFF, and that is load-bearing: the entire e2e suite bootstraps itself through
 * `POST /api/auth/sign-up/email`, so a flag that defaulted on would make the product untestable and
 * every fresh self-hosted instance unbootstrappable. Accepts "1"/"true", case-insensitively, with
 * surrounding whitespace tolerated — the same spelling `isSignupDisabledByEnv` already accepts for
 * `DISABLE_AUTH`, so an operator does not have to remember two conventions.
 */
export function isOidcOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.OIDC_ONLY ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

// ---------------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------------

/**
 * Every provider id account linking is allowed to trust — the INSTANCE's own, and only that one.
 *
 * "Trusted" in better-auth means "may be linked to a local account without the provider having to
 * assert `email_verified`" (`dist/api/routes/callback.mjs`'s `link` branch and
 * `dist/api/routes/account.mjs`'s `linkSocial` both waive that requirement for a listed id). That is
 * a statement about who VOUCHES for a provider, and the only provider anyone vouches for here is the
 * one the operator put in the environment. A per-company provider is typed into a settings form by a
 * customer: `PUT /company/sso` (`modules/company/sso/sso.controller.ts`) takes any public
 * authorization/token/userinfo URL, requires no relationship whatsoever between that host and any
 * domain the company has proven it controls, and is reachable by anyone at all — signup is open by
 * default and `POST /api/companies` makes the caller OWNER of a brand-new company. Listing such an id
 * here would mean the instance vouches for an identity provider an attacker registered five minutes
 * ago.
 *
 * Per-company ids were listed here, through a function re-resolved per request. Do not put them back.
 */
export function trustedProviderIds(params: { env: EnvOidcProvider }): string[] {
  // The environment provider is listed whether or not it is registered, exactly as before: this used
  // to be `[process.env.OIDC_NAME || 'Generic OIDC']`, unconditionally. Trusting an id no provider
  // answers to is inert (nothing can ever present it), so narrowing it here would be a behaviour
  // change for existing deployments with no security benefit.
  return [params.env.providerId];
}

/** The `account.accountLinking` block `lib/auth.ts` hands better-auth, in one testable place. */
export type AccountLinkingOptions = NonNullable<NonNullable<BetterAuthOptions['account']>['accountLinking']>;

/**
 * Which OAuth identities better-auth may attach to an account that already exists locally: none.
 *
 * `disableImplicitLinking` is the load-bearing field, and it is the ONLY one of better-auth's
 * account-linking switches that actually closes this. Left at its default, an OAuth callback looks
 * the incoming identity up by EMAIL ADDRESS (`dist/oauth2/link-account.mjs`, `findUserByEmail`), and
 * when it finds a row it binds the incoming provider account to that user and issues that user's
 * session. The three other conditions guarding that branch are all things an attacker controls or
 * cannot be relied on:
 *  - "the provider is trusted" — narrowed just above, but it only matters when the provider does NOT
 *    assert `email_verified`, and an attacker running his own identity provider asserts whatever he
 *    likes about whichever address he likes;
 *  - "the local row is already verified" (`requireLocalEmailVerified`, default on) — a library
 *    default this repository does not set, which its own type marks deprecated and slated to become
 *    unconditional, and which is true of every account ever provisioned through any IdP;
 *  - `enabled: false` — which would also disable the deliberate, authenticated `linkSocial` flow.
 * So the rule is stated positively instead: an OAuth sign-in may create a user or sign an
 * already-bound one in, and it may never ADOPT a local account it merely shares an address with.
 * Linking an additional provider to an existing account stays possible through `linkSocial`, where
 * the request carries the account owner's own session and the owner is the one asking.
 *
 * The concrete attack this refuses, which no configuration comment should have to be reconstructed
 * from: register a company (open to any authenticated caller), point `PUT /company/sso` at a
 * Keycloak you host, have it answer the userinfo request with another tenant's employee's address
 * and `"email_verified": true`, and walk away with that employee's session and every company they
 * belong to.
 */
export function accountLinkingOptions(params: { env: EnvOidcProvider }): AccountLinkingOptions {
  return {
    enabled: true,
    disableImplicitLinking: true,
    trustedProviders: trustedProviderIds(params),
  };
}

// ---------------------------------------------------------------------------
// A tenant IdP may only ever vouch for a user inside its own company
// ---------------------------------------------------------------------------

/**
 * The refusal handed back to better-auth when a per-company identity provider tries to be attached
 * to somebody who is not in that company.
 *
 * `error` is surfaced to the client verbatim, so it names the RULE rather than the user it was
 * evaluated against: "no such membership" would tell a caller who is and is not a member of a
 * company he has no part in, which is the enumeration primitive `SsoLookupResult` is shaped to
 * avoid on the public lookup route.
 */
export const SSO_LINK_OUTSIDE_COMPANY: ValidateUserInfoResult = {
  error: 'sso_provider_outside_company',
  errorDescription:
    'This identity provider may only be linked to an account that already belongs to its company.',
};

/**
 * The company that has to vouch for an account link, or null when this validation is not one.
 *
 * Returns non-null ONLY for the `link-account` action from a per-company provider — the single
 * operation in which an identity asserted by one tenant's IdP gets attached to a user row that
 * already exists. `create-user` (nobody to take over yet, and the new row is attached to that same
 * provider's company by `companyForOAuthSignup` above) and `sign-in` (the account was already bound
 * to this exact provider and `sub`, which is what proved the binding) are deliberately out of scope:
 * gating either would refuse an employee their own employer's IdP without closing anything.
 *
 * Takes `unknown` and walks it defensively for the same reason `providerIdFromEndpointContext` does:
 * this is a third-party runtime shape, and a hook that throws on an unexpected field would turn every
 * sign-in into a 403 (better-auth converts a throw in this hook into one — see
 * `dist/utils/validate-user-info.mjs`).
 */
export function companyThatMustVouchForLink(source: unknown): string | null {
  if (typeof source !== 'object' || source === null) return null;

  const { action, oauth, sso } = source as { action?: unknown; oauth?: unknown; sso?: unknown };
  if (action !== 'link-account') return null;

  const providerIdOf = (info: unknown): string | null => {
    if (typeof info !== 'object' || info === null) return null;
    const id = (info as { providerId?: unknown }).providerId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  };

  // `oauth` is what the generic-OAuth plugin every company provider is built from fills in; `sso` is
  // read too so that mounting better-auth's own SSO plugin later cannot silently step around this.
  return companyIdFromProviderId(providerIdOf(oauth) ?? providerIdOf(sso));
}

/** better-auth's `user.validateUserInfo` hook, exactly as the library declares it. */
export type ValidateUserInfoHook = NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']>;

/**
 * The hook `lib/auth.ts` installs as `user.validateUserInfo` — the repository's OWN half of the rule
 * "a tenant's identity provider speaks for that tenant's members, and for nobody else".
 *
 * Without it, which identity provider may speak for which user would rest entirely on better-auth's
 * `account.accountLinking` defaults, and those defaults are exactly what made a cross-tenant takeover
 * possible: any company administrator can register an OIDC provider from the SSO settings screen
 * (`modules/company/sso/sso.controller.ts`'s `PUT /company/sso`, which requires no proof of any kind
 * that the provider has anything to do with any domain the company controls), and a provider
 * better-auth considers trusted may adopt a pre-existing local account matched by EMAIL ALONE. Point
 * such a provider at a Keycloak you host, have it assert
 * `{"email":"someone@another-tenant.example","email_verified":true}`, and better-auth hands back that
 * person's session. `accountLinkingOptions` above closes the implicit path; this closes the explicit
 * one and keeps the rule stated in code this repository owns rather than in a library default a
 * version bump can change.
 *
 * FAIL-CLOSED throughout, which is the whole point of this being a gate:
 *  - no usable user id on a link that needs one — refuse; better-auth is asking whether to hand this
 *    identity an existing account, and "there is nothing to check against" is not a yes;
 *  - `isCompanyMember` throwing (the database is down) — refuse, which better-auth turns into a 403
 *    of its own (`dist/utils/validate-user-info.mjs` catches a throw here rather than continuing).
 */
export function ssoLinkValidator(params: {
  isCompanyMember: (userId: string, companyId: string) => Promise<boolean>;
}): ValidateUserInfoHook {
  return async ({ user, source }) => {
    const companyId = companyThatMustVouchForLink(source);
    if (companyId === null) return;

    const userId = typeof user.id === 'string' && user.id.length > 0 ? user.id : null;
    if (userId === null) return { ...SSO_LINK_OUTSIDE_COMPANY };

    if (await params.isCompanyMember(userId, companyId)) return;
    return { ...SSO_LINK_OUTSIDE_COMPANY };
  };
}

// ---------------------------------------------------------------------------
// Which company does a brand-new OAuth user belong to?
// ---------------------------------------------------------------------------

/**
 * The role an SSO-provisioned user is given in the company whose IdP vouched for them.
 *
 * MEMBER, deliberately. Nothing about an SSO arrival vouches for elevated rights: there is no
 * invitation, so nobody inside the company chose this person's level — only their IdP asserted that
 * they exist. MEMBER is also `UserCompany.role`'s own schema default and the default
 * `InvitationsService.createInvitation` uses, and the settings screen hides the administrative tabs
 * (members, invitations, API keys, webhooks, channels, signing, SSO itself, danger zone) from a
 * MEMBER — so the failure mode of this choice is "an admin has to promote them", never "a stranger
 * from a federated directory can rewrite the company's SSO configuration".
 */
export const SSO_PROVISIONED_ROLE: CompanyRole = CompanyRole.MEMBER;

/**
 * The provider id of the OAuth account being created, read off better-auth's own endpoint context.
 *
 * `databaseHooks.user.create.before/after` receive `(data, context)` where `context` is whatever
 * endpoint is in flight (`dist/db/with-hooks.mjs` passes
 * `tryGetCurrentAuthEndpointContext()`), and the user row is created BEFORE its account row
 * (`dist/oauth2/link-account.mjs` creates the user, then the account, inside one transaction) — so
 * the account itself cannot be consulted yet. The provider id is instead read from whichever of the
 * two endpoints that can create an OAuth user is running:
 *  - `/callback/:id`, the browser redirect flow — `params.id`;
 *  - `/sign-in/social`, the id_token flow — `body.provider`.
 * Returns null for every other path (email/password signup above all), which is what keeps the
 * invitation flow untouched.
 *
 * Takes `unknown` and walks it defensively: this is a third-party runtime shape, typed as a `Partial`
 * by better-auth itself, and a missing field here must mean "not an OAuth signup", never a crash
 * inside a database hook.
 */
export function providerIdFromEndpointContext(context: unknown): string | null {
  if (typeof context !== 'object' || context === null) return null;
  const { params, body } = context as { params?: unknown; body?: unknown };

  if (typeof params === 'object' && params !== null) {
    const id = (params as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }

  if (typeof body === 'object' && body !== null) {
    const provider = (body as { provider?: unknown }).provider;
    if (typeof provider === 'string' && provider.length > 0) return provider;
  }

  return null;
}

/**
 * The company a brand-new user arriving through OAuth should be attached to, or null when this
 * signup is not a per-company SSO one.
 *
 * This is the hole the feature would otherwise leave: `UserCompany` rows are created ONLY by
 * `markInvitationAsUsed`, and an employee arriving through their own company's IdP has no
 * invitation — so without this they would land with zero companies and drop into the
 * company-creation wizard, inside a product their employer already pays for. When this returns a
 * company id, the invitation path must be skipped entirely rather than consulted and found empty.
 */
export function companyForOAuthSignup(context: unknown): string | null {
  return companyIdFromProviderId(providerIdFromEndpointContext(context));
}

// ---------------------------------------------------------------------------
// Names: what an IdP actually sends, versus what the schema requires
// ---------------------------------------------------------------------------

export interface UserNameParts {
  firstname: string;
  lastname: string;
  /** Absent only when there is nothing nameable at all; the column is nullable, unlike the two above. */
  name?: string;
}

const presentString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Fill in the name columns for a user about to be inserted, without ever overwriting a value the
 * caller already supplied.
 *
 * `User.firstname` and `User.lastname` are `String` — NOT NULL, no default — while an identity
 * provider is under no obligation to send `given_name`/`family_name`: plenty send only `name`, and
 * some send neither. Left alone, such a sign-in fails at the INSERT, which is a 500 in the middle of
 * an OAuth callback rather than anything a user could act on. So the order is: what was supplied, then
 * the OIDC claims, then a split of the full name, then the email's local part, and an empty surname as
 * the floor — a cosmetic field is never worth refusing an otherwise valid federated sign-in over, and
 * the user can correct it in account settings.
 *
 * The pre-existing rules are preserved exactly: `given_name`/`family_name` map onto
 * firstname/lastname, and `name` is recomputed from the two whenever both are known (which is what
 * email/password sign-up already relied on).
 */
export function deriveUserNames(raw: Record<string, unknown>): UserNameParts {
  const fullName = presentString(raw.name);
  const email = presentString(raw.email);

  let firstname = presentString(raw.firstname) ?? presentString(raw.given_name);
  let lastname = presentString(raw.lastname) ?? presentString(raw.family_name);

  if (!firstname || !lastname) {
    const tokens = (fullName ?? '').split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length > 0) {
      firstname ??= tokens[0];
      lastname ??= tokens.slice(1).join(' ') || undefined;
    }
  }

  if (!firstname && email) {
    firstname = presentString(email.slice(0, email.lastIndexOf('@')));
  }

  firstname ??= '';
  lastname ??= '';

  const name = firstname && lastname ? `${firstname} ${lastname}` : (fullName ?? presentString(firstname));
  return { firstname, lastname, name };
}

// ---------------------------------------------------------------------------
// Email-first lookup
// ---------------------------------------------------------------------------

/** The bare, lowercased domain of an email address, or null when it is not one. */
export function emailDomain(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;

  // Trim the WHOLE address, never the domain part on its own. A copy-pasted address with a trailing
  // newline is still an address; "alice@ acme.com" is not one at all — and trimming the slice instead
  // would quietly turn that second case into a valid-looking claim on "acme.com", which is precisely
  // the normalisation this function exists to refuse.
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;

  const domain = trimmed.slice(at + 1).toLowerCase();
  // Whitespace anywhere inside means this was never a single address. (`lastIndexOf` above already
  // rules out a second "@" appearing here.)
  if (/\s/.test(domain)) return null;
  return domain;
}

/** Normalise an operator-supplied domain list: bare, lowercased, de-duplicated, blanks dropped. */
export function normalizeDomains(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    // Tolerate "@acme.com" and "Acme.COM" — both are what a human actually types. Also tolerate a
    // trailing dot ("acme.com."): that is the legal, fully-qualified form of a domain name (it means
    // "resolve from the DNS root, not relative to a search suffix") and some tools — a zone file, a
    // resolver's own output, `dig`'s ANSWER section — print domains that way, so a user copying from
    // one of those would otherwise paste something that can never match the bare form stored
    // everywhere else (`buildVerificationRecordName`, the `providerId_domain` unique index, the
    // `lookupByEmail` query) even though it names the exact same domain. Only ONE trailing dot is
    // meaningful in DNS and only at the very end, hence the anchored, non-repeating `\.$`.
    //
    // Deliberately NOT doing any IDNA/punycode normalisation here: an internationalised domain typed
    // as Unicode versus as its "xn--" punycode form are different strings, and this function has no
    // way to know they name the same DNS label. That fails CLOSED — the two spellings simply never
    // match each other, so nobody can use a homoglyph or an alternate encoding to merge with or claim
    // a domain someone else already verified — so it is left alone rather than reached for here.
    const domain = entry.trim().toLowerCase().replace(/^@+/, '').replace(/\.$/, '');
    if (domain.length === 0 || /[\s@/]/.test(domain)) continue;
    out.add(domain);
  }
  return [...out];
}

/** One stored row, reduced to exactly the facts the lookup decision needs. */
export interface SsoLookupCandidate {
  providerId: string;
  label: string;
  isActive: boolean;
  // Only the domains this row has PROVEN via the DNS TXT challenge (`lib/sso-domain-verification.ts`)
  // — never the full claimed list. This used to be `emailDomains: string[]` plus a single
  // `domainsVerifiedAt: Date | null` covering the WHOLE array, which could not express "acme.com is
  // proven, gmail.com (added later) is not" — see `CompanySsoDomain`'s own schema comment for why that
  // shape was replaced. The caller (`sso.service.ts#lookupByEmail`) is responsible for filtering
  // `CompanySsoDomain` rows down to `verifiedAt != null` before building this list, so this function
  // never has to know about an unverified claim to correctly refuse it.
  verifiedDomains: string[];
}

/**
 * What the @Public() lookup is allowed to return: the provider to use and what to call it. Nothing
 * else — no company id, no company name, no endpoint, no domain list. The shape is the guarantee,
 * the same way `ChannelConfigStatus` is: an anonymous, rate-limited endpoint that cannot be made to
 * enumerate a customer's configuration because its return type has nowhere to put one.
 */
export interface SsoLookupResult {
  providerId: string;
  label: string;
}

/**
 * Which provider (if any) an email address should be sent to.
 *
 * A row matches only when it is ACTIVE and the SPECIFIC domain being looked up is among its VERIFIED
 * domains (`lib/sso-domain-verification.ts`'s DNS TXT challenge, run from
 * `modules/company/sso/sso.controller.ts`'s verify route — the only place a `CompanySsoDomain` ever
 * gains a `verifiedAt`). This gate is exactly as strict as it was when verification did not exist at
 * all: an unverified claim is still not a claim this function will act on, because honouring one would
 * let any company that can reach the settings screen type "gmail.com" and have strangers' sign-ins
 * routed at its own IdP — a credential-phishing primitive. The direct link
 * (/auth/sign-in?sso=c_<companyId>) remains the only way to reach a provider whose domain is not (yet)
 * verified.
 */
export function resolveSsoLookup(
  candidates: readonly SsoLookupCandidate[],
  email: string | null | undefined,
): SsoLookupResult | null {
  const domain = emailDomain(email);
  if (!domain) return null;

  for (const candidate of candidates) {
    if (!candidate.isActive) continue;
    if (!candidate.verifiedDomains.includes(domain)) continue;
    return { providerId: candidate.providerId, label: candidate.label };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Is a stored row actually usable?
// ---------------------------------------------------------------------------

/**
 * Whether a row carries enough endpoint information to build a provider from.
 *
 * Either a discovery URL (better-auth's generic-OAuth plugin derives authorization/token/userinfo
 * and the JWKS from it) or, spelled out, at least an authorization URL and a token URL — the two the
 * plugin itself refuses to proceed without (`dist/plugins/generic-oauth/index.mjs` logs
 * "discovery left no usable authorization endpoint or token exchange" and SKIPS the provider). A
 * userinfo URL is genuinely optional: an id_token carrying `sub` and `email` is enough.
 */
export function ssoEndpointsComplete(config: {
  discoveryUrl?: string | null;
  authorizationUrl?: string | null;
  tokenUrl?: string | null;
}): boolean {
  const present = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0;
  if (present(config.discoveryUrl)) return true;
  return present(config.authorizationUrl) && present(config.tokenUrl);
}
