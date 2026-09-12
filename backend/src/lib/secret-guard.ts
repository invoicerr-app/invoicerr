/**
 * Boot-time guard against known-insecure auth secrets — SECURITY_AUDIT.md finding #3 (Haute).
 *
 * `docker-compose.yml` used to ship non-empty, PUBLIC (committed) example values for both
 * `JWT_SECRET` ("your_jwt_secret") and `BETTER_AUTH_SECRET` ("your_better_auth_secret"). Neither
 * looks empty, so a copy-pasted, unmodified compose file boots with zero warning and a
 * session/cookie-signing secret anyone can read on GitHub — total auth bypass (forge a valid
 * session for any userId, no password needed).
 *
 * better-auth's OWN `validateSecret` (node_modules/better-auth/dist/context/create-context.mjs)
 * does not catch this: it only compares the effective secret against ITS OWN internal
 * `DEFAULT_SECRET` constant, has no idea these two example strings exist, and skips validation
 * entirely under `isTest()`. This guard is a separate, explicit check for OUR OWN known-bad
 * values, independent of and in addition to that one.
 *
 * `findInsecureSecret` is a pure function — deliberately never reads `process.env` itself and
 * throws nothing — so a test can drive it "cold", with synthetic env objects, exactly like
 * `lib/registration-policy.ts`'s `decideRegistration`. `assertSecretsConfiguredForBoot` is the
 * thin, throwing wrapper actually called from `main.ts`.
 *
 * The effective secret is `BETTER_AUTH_SECRET || JWT_SECRET` — the EXACT fallback `lib/auth.ts`
 * itself uses (`secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET`) — not each
 * variable checked independently. That matters: `.env.example` never sets `JWT_SECRET` at all
 * (only `BETTER_AUTH_SECRET`, documented there as the one that's actually required), so a
 * deployment that correctly sets only `BETTER_AUTH_SECRET` must NOT be failed over an unset
 * `JWT_SECRET` it never needed in the first place. Checking the effective value also means a
 * leftover placeholder in the variable that ISN'T actually used (e.g. `BETTER_AUTH_SECRET` is a
 * real secret but `JWT_SECRET` still says "your_jwt_secret") correctly does not trip the guard.
 *
 * Gated to `NODE_ENV === 'production'` only — see the call site in `main.ts` — NOT because a
 * placeholder is ever legitimate anywhere, but because neither `.env.test` nor a bare local `.env`
 * sets either variable at all (better-auth's own `DEFAULT_SECRET` fallback covers dev/test, and
 * `isTest()` skips its own validation there too), and putting a real secret into `.env.test` just
 * to satisfy an all-environments guard would mean committing a real secret to a versioned file —
 * worse than the problem this fixes. Production is also the only environment finding #3 actually
 * threatens (a placeholder deployed and reachable on the internet). Confirmed this choice does not
 * break `npm run start:test` (see `secret-guard.spec.ts`).
 */

const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set(
  [
    'your_jwt_secret',
    'your_better_auth_secret',
    'your-jwt-secret',
    'your-better-auth-secret',
    'changeme',
    'change_me',
    'change-me',
    'secret',
    'password',
    'your_secret',
    'your-secret',
    'example',
    // better-auth's own internal default (utils/constants.mjs) — belt and suspenders in case it
    // is ever passed through explicitly instead of left unset.
    'better-auth-secret-12345678901234567890',
  ].map((value) => value.toLowerCase()),
);

// Prefixes rather than exact strings: catches instructive placeholders like this repo's own
// `docker-compose.yml` value (`CHANGE_ME_generate_with_openssl_rand_hex_32`) without having to
// keep an exact-match list in sync with that file's exact wording, and generalises to the same
// boilerplate other self-hosted projects commonly use.
const PLACEHOLDER_PREFIXES: readonly string[] = [
  'your_',
  'your-',
  'change_me',
  'changeme',
  'change-me',
  'replace_me',
  'replace-me',
  'placeholder',
  'insert_',
  'todo_',
  'xxxx',
];

const looksLikePlaceholder = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    PLACEHOLDER_SECRETS.has(normalized) ||
    PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
};

export type InsecureSecretReason = 'empty' | 'placeholder';

export interface InsecureSecretFinding {
  /** The env var that actually supplies the effective secret (or would, if it weren't blank). */
  variable: 'BETTER_AUTH_SECRET' | 'JWT_SECRET';
  reason: InsecureSecretReason;
  /** Only set for reason "placeholder" — the offending value, for an explicit error message. */
  value?: string;
}

const blank = (raw: string | undefined): string | undefined => {
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Pure check of the effective auth secret. Returns `null` when it is a real, non-placeholder
 * value; otherwise a finding naming the exact variable and reason so the caller can build an
 * explicit error message.
 */
export function findInsecureSecret(env: NodeJS.ProcessEnv = process.env): InsecureSecretFinding | null {
  const betterAuthSecret = blank(env.BETTER_AUTH_SECRET);
  const jwtSecret = blank(env.JWT_SECRET);
  const effective = betterAuthSecret ?? jwtSecret;

  if (!effective) {
    // Neither variable supplies anything: point at BETTER_AUTH_SECRET, the recommended/documented
    // one (`.env.example` never even mentions JWT_SECRET), regardless of whether JWT_SECRET also
    // happens to be blank — that's the actionable variable to set.
    return { variable: 'BETTER_AUTH_SECRET', reason: 'empty' };
  }
  if (looksLikePlaceholder(effective)) {
    // Non-blank: name whichever variable actually supplies the effective (bad) value — mirrors
    // lib/auth.ts's own `BETTER_AUTH_SECRET || JWT_SECRET` fallback exactly.
    const variable: 'BETTER_AUTH_SECRET' | 'JWT_SECRET' = betterAuthSecret
      ? 'BETTER_AUTH_SECRET'
      : 'JWT_SECRET';
    return { variable, reason: 'placeholder', value: effective };
  }
  return null;
}

export function insecureSecretMessage(finding: InsecureSecretFinding): string {
  const base =
    finding.reason === 'empty'
      ? `${finding.variable} is not set.`
      : `${finding.variable} is set to "${finding.value}", a well-known placeholder value.`;
  return (
    `[secret-guard] Refusing to boot: ${base} This signs every session cookie/JWT — set a real ` +
    `BETTER_AUTH_SECRET (generate one with \`openssl rand -hex 32\`); the docker-compose example ` +
    'value is public (committed to the repository) and must never be used as-is. See ' +
    'SECURITY_AUDIT.md finding #3.'
  );
}

/**
 * Throws a named, explicit error if the effective auth secret is empty or a known placeholder.
 * Called from `main.ts`, gated to `NODE_ENV === 'production'` — see this file's own header for
 * why. Takes `env` for testability; defaults to `process.env` at the real call site.
 */
export function assertSecretsConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const finding = findInsecureSecret(env);
  if (finding) {
    throw new Error(insecureSecretMessage(finding));
  }
}

// ---------------------------------------------------------------------------
// OIDC_ONLY — refuse to boot an instance nobody could ever log into
// ---------------------------------------------------------------------------

/**
 * `OIDC_ONLY` disables email/password entirely (`lib/auth.ts`'s `emailAndPassword.enabled`). If it is
 * set while NO OIDC provider exists — neither the environment one nor any company's own — then every
 * single authentication path on the instance is closed and nobody, operator included, can ever sign
 * in again. There is no recovery through the product: creating the first company's SSO provider
 * itself requires being signed in.
 *
 * So this is a refusal to boot, in the same spirit as `findInsecureSecret` above, and pure for the
 * same reason: it takes the facts rather than discovering them, so a spec can drive it cold.
 *
 * Unlike `assertSecretsConfiguredForBoot`, this one is NOT gated to production — a developer or a CI
 * job that sets the flag without a provider is locked out just as completely, and would otherwise
 * spend the debugging time on a login screen that simply rejects everything.
 *
 * It also cannot be called from `main.ts` beside its sibling: answering "does any company have one?"
 * means reading `CompanySsoProvider`, and the place that already reads exactly those rows at boot is
 * `modules/company/sso/sso-registrar.service.ts`, which asserts this once it knows how many it
 * registered.
 */
export interface OidcOnlyProviderFacts {
  /** Whether `OIDC_ONLY` is set — `lib/sso-policy.ts#isOidcOnly` is the one place that decides. */
  oidcOnly: boolean;
  /** Whether the instance-wide environment provider is registered. */
  envProviderRegistered: boolean;
  /** How many per-company providers were successfully registered. */
  companyProviderCount: number;
}

export type OidcOnlyLockoutReason = 'no_provider';

/**
 * Pure check. Returns `null` when the instance is fine (the flag is off, or at least one provider
 * exists), otherwise the reason, so the caller can build an explicit message.
 */
export function findOidcOnlyLockout(facts: OidcOnlyProviderFacts): OidcOnlyLockoutReason | null {
  if (!facts.oidcOnly) {
    return null;
  }
  if (facts.envProviderRegistered || facts.companyProviderCount > 0) {
    return null;
  }
  return 'no_provider';
}

export function oidcOnlyLockoutMessage(): string {
  return (
    '[secret-guard] Refusing to boot: OIDC_ONLY is set, which disables email/password sign-in, but ' +
    'this instance has no OIDC provider at all — neither an environment one (set OIDC_CLIENT_ID, and ' +
    'OIDC_NAME for its id) nor any company-registered one. Nobody, including you, would be able to ' +
    'sign in. Unset OIDC_ONLY, or configure a provider first.'
  );
}

/** Throws a named, explicit error when `OIDC_ONLY` would lock every user out of the instance. */
export function assertOidcOnlyHasProvider(facts: OidcOnlyProviderFacts): void {
  if (findOidcOnlyLockout(facts)) {
    throw new Error(oidcOnlyLockoutMessage());
  }
}
