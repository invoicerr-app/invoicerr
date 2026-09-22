/**
 * Pure decision for `lib/auth.ts`'s email/password sign-up hook: must this sign-up be refused for lack
 * of legal-document acceptance? SaaS mode only (`billing-flag.ts#isBillingEnabled`) — self-hosted has
 * nothing to accept (`documentation/docs/legal/privacy-policy.md`'s own Preamble: a self-hosted
 * instance never sends us any data), so `billingEnabled: false` always returns `false` here, the same
 * "check the flag first, no-op otherwise" discipline every other billing entry point in this codebase
 * follows (`seat-sync.ts`, `send-gate.ts`...).
 *
 * Deliberately does NOT apply to an OAuth/SSO sign-up (company-provisioned or the instance-wide OIDC
 * provider) — `lib/auth.ts` only calls this for the plain email/password branch. Neither flow's own
 * screen carries the checkbox this gate exists to require, and an OIDC identity provider has no way to
 * answer it; gating those the same way would turn a company's own SSO sign-in, or the instance-wide
 * provider's, into a permanent dead end in SaaS mode.
 */
export function legalAcceptanceRequiredAtSignup(billingEnabled: boolean, acceptLegal: unknown): boolean {
  if (!billingEnabled) return false;
  // Only a literal `true` counts — untyped wire input (`context.body.acceptLegal` off a raw HTTP
  // body), so a typo'd truthy value (`"true"` the string, `1`) is treated as NOT accepted rather than
  // coerced leniently, the same "a bad value is refused, never silently waved through" posture
  // `registration-policy.ts`'s own header describes for an invitation code.
  return acceptLegal !== true;
}

/** Read off better-auth's own endpoint context the same defensive way
 *  `sso-policy.ts#providerIdFromEndpointContext` reads `context.body.provider` — `context` is a
 *  third-party runtime shape (`Partial<EndpointContext>`), so a missing/malformed field here must mean
 *  "not accepted", never a crash inside a database hook. */
export function acceptLegalFromEndpointContext(context: unknown): boolean {
  if (typeof context !== 'object' || context === null) return false;
  const { body } = context as { body?: unknown };
  if (typeof body !== 'object' || body === null) return false;
  return (body as { acceptLegal?: unknown }).acceptLegal === true;
}

export const LEGAL_ACCEPTANCE_REQUIRED_CODE = 'LEGAL_ACCEPTANCE_REQUIRED';
export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
  'You must accept the Terms of Service and the Privacy Policy to create an account.';
