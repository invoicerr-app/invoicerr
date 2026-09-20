/**
 * The process-local set of per-company SSO provider ids currently registered with better-auth.
 *
 * Why this exists as its own module rather than as state on the Nest service that maintains it:
 * `modules/company/sso/sso-registrar.service.ts` writes it and reads the count back to decide whether
 * an OIDC_ONLY instance has any way in at all, and it imports `lib/auth.ts` to reach `auth.$context`
 * — so keeping this state in `lib/auth.ts` would have made that a cycle. A leaf module both can
 * depend on breaks it. `pendingSignupStore` in `lib/auth.ts` is the same process-level-shared-state
 * pattern, for the same reason.
 *
 * This set is emphatically NOT an input to account linking. It used to be: `lib/auth.ts` read the
 * whole list into `account.accountLinking.trustedProviders`, which told better-auth that every IdP
 * any customer had typed into the SSO settings screen was allowed to be attached to a local account
 * matched by email address — see `sso-policy.ts#trustedProviderIds` for what that let one tenant do
 * to another's users.
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

/** How many per-company providers are live — what the OIDC_ONLY boot assertion counts. */
export function registeredCompanyProviderCount(): number {
  return registered.size;
}

/** Test seam: forget everything, so one spec's registrations cannot leak into the next. */
export function resetRegisteredCompanyProviders(): void {
  registered.clear();
}
