/**
 * Where the app lands the instant the caller's own membership on the ACTIVE company ends —
 * "Leave company" (members.settings.tsx) and "Delete company" (danger.settings.tsx) both call this
 * as their very last step, once the backend mutation itself already succeeded.
 *
 * A same-tab client-side navigate is NOT enough here: this app fetches company-scoped data through
 * two unrelated mechanisms (TanStack Query and the older useGet/usePost pair — see sidebar.tsx's own
 * `switchCompany` comment for why THAT function already reloads instead of navigating), and neither
 * cache keys its entries by companyId. A soft `navigate("/dashboard")` would carry every other
 * screen's already-cached data (company info, seats, branding…) for a company this user may no
 * longer even belong to straight into the next screen. A hard reload is the only thing that forces
 * every one of those caches to start over under whichever company (or none) is active now — the
 * freshly loaded session then decides for itself, in Sidebar's own onboarding effect, whether another
 * membership took over or the create-company dialog needs to open.
 */
export function afterCompanyGone(): void {
  window.location.href = "/dashboard"
}
