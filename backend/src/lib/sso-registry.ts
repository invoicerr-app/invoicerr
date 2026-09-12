/**
 * The process-local set of per-company SSO provider ids currently registered with better-auth.
 *
 * Why this exists as its own module rather than as state on the Nest service that maintains it:
 * `lib/auth.ts` needs to READ it on every request (`account.accountLinking.trustedProviders` is
 * re-resolved per request — see `sso-policy.ts#trustedProviderIds`), and
 * `modules/company/sso/sso-registrar.service.ts` needs to WRITE it. The registrar imports
 * `lib/auth.ts` to reach `auth.$context`, so having `lib/auth.ts` import the registrar back would be
 * a cycle. A leaf module both can depend on breaks it. `pendingInvitationCodes` in `lib/auth.ts` is
 * the same process-level-shared-state pattern, for the same reason.
 *
 * Deliberately NOT a database query: `trustedProviders` runs on every authenticated request, and
 * paying a round-trip there to re-derive a set the registrar already knows would tax every request
 * in the product for a fact that only changes when somebody edits their SSO settings.
 *
 * Process-local, so on a multi-process deployment each process populates it at its own boot and
 * updates it when IT serves the write. A write served by one API process therefore does not register
 * the provider in another's memory until that one restarts — the same limitation the registration
 * mechanism itself has (better-auth's provider list is in-memory), and the reason registration is
 * driven from the stored rows at every boot rather than only on write.
 */

const registered = new Set<string>();

/** Record that a per-company provider is live in this process's better-auth context. */
export function markCompanyProviderRegistered(providerId: string): void {
  registered.add(providerId);
}

/** Record that a per-company provider is no longer live (deleted, or deactivated). */
export function markCompanyProviderUnregistered(providerId: string): void {
  registered.delete(providerId);
}

/** Every per-company provider id live in this process, for account linking to trust. */
export function registeredCompanyProviderIds(): string[] {
  return [...registered];
}

/** How many per-company providers are live — what the OIDC_ONLY boot assertion counts. */
export function registeredCompanyProviderCount(): number {
  return registered.size;
}

/** Test seam: forget everything, so one spec's registrations cannot leak into the next. */
export function resetRegisteredCompanyProviders(): void {
  registered.clear();
}
