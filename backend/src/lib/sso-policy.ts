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
 * Every provider id account linking is allowed to trust.
 *
 * better-auth re-resolves `account.accountLinking.trustedProviders` PER REQUEST when it is given as
 * a function (`dist/context/helpers.mjs#getTrustedProviders`), which is the only reason a tenant
 * provider registered after boot can ever be trusted: the static one-element array this used to be
 * was resolved once, at import time, when no company provider existed yet. Without this, a user
 * arriving through their own company's IdP whose email already exists would be refused the link
 * instead of being signed in.
 */
export function trustedProviderIds(params: {
  env: EnvOidcProvider;
  companyProviderIds: Iterable<string>;
}): string[] {
  const ids = new Set<string>();
  // The environment provider is listed whether or not it is registered, exactly as before: this used
  // to be `[process.env.OIDC_NAME || 'Generic OIDC']`, unconditionally. Trusting an id no provider
  // answers to is inert (nothing can ever present it), so narrowing it here would be a behaviour
  // change for existing deployments with no security benefit.
  ids.add(params.env.providerId);
  for (const id of params.companyProviderIds) ids.add(id);
  return [...ids];
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
    // Tolerate "@acme.com" and "Acme.COM" — both are what a human actually types.
    const domain = entry.trim().toLowerCase().replace(/^@+/, '');
    if (domain.length === 0 || /[\s@/]/.test(domain)) continue;
    out.add(domain);
  }
  return [...out];
}

/** One stored row, reduced to exactly the facts the lookup decision needs. */
export interface SsoLookupCandidate {
  providerId: string;
  label: string;
  emailDomains: string[];
  isActive: boolean;
  domainsVerifiedAt: Date | null;
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
 * A row matches only when it is ACTIVE and its domains are VERIFIED. `domainsVerifiedAt` is never
 * set by this feature — it ships no verification challenge — so in practice this endpoint matches
 * nothing until a future challenge fills that column in. That is the deliberate choice: an
 * unverified domain list is a claim, and honouring a claim would let any company that can reach the
 * settings screen type "gmail.com" and have strangers' sign-ins routed at its own IdP, which is a
 * credential-phishing primitive. Shipping the lookup inert, behind a column nothing trusts, is
 * strictly better than shipping that hole — and the direct link
 * (/auth/sign-in?sso=c_<companyId>) is what actually gets a customer's users in today.
 */
export function resolveSsoLookup(
  candidates: readonly SsoLookupCandidate[],
  email: string | null | undefined,
): SsoLookupResult | null {
  const domain = emailDomain(email);
  if (!domain) return null;

  for (const candidate of candidates) {
    if (!candidate.isActive) continue;
    if (candidate.domainsVerifiedAt == null) continue;
    if (!candidate.emailDomains.includes(domain)) continue;
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
