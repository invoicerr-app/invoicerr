/**
 * The client portal's OWN fetch transport — deliberately NOT `authenticatedFetch`
 * (hooks/use-fetch.ts): that helper sends the STAFF session cookie (`credentials: "include"`) and,
 * on a 401, redirects to `/auth/sign-in` — exactly the wrong behavior for an anonymous client browsing
 * `/portal/*`, who has no staff account to sign into at all. A portal session is a THIRD, separate
 * credential (see the backend's own `client-portal/portal-auth.guard.ts` header for the full "why a
 * bearer header, never a cookie" reasoning): a long-lived token, captured once from the `/portal/:token`
 * link and held in `localStorage`, sent as `Authorization: Bearer <token>` on every call this file
 * makes. `app.enableCors()` (backend `main.ts`) already reflects back whatever headers a preflight
 * asks for, so this needs no new CORS wiring.
 *
 * Kept in its own file (not folded into `use-fetch.ts`) so which credential a call carries is a
 * per-FILE fact a reader does not have to trace through branches to be sure of — the same discipline
 * `public-documents.controller.ts`'s own header holds for keeping the one unauthenticated backend
 * route in a file of its own.
 */
const PORTAL_TOKEN_STORAGE_KEY = "invoicerr_portal_token"

/** Every localStorage access is wrapped: a private window, cleared site data, or a browser that
 *  blocks storage outright must degrade to "no token" (a normal, functional un-signed-in portal
 *  state), never throw and break the whole page. */
export function getPortalToken(): string | null {
  try {
    return localStorage.getItem(PORTAL_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setPortalToken(token: string): void {
  try {
    localStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, token)
  } catch {
    // Storage unavailable — the token still works for the CURRENT page load's in-memory calls made
    // right after `[token].tsx` captures it; only a later reload would lose it. Never a hard failure.
  }
}

export function clearPortalToken(): void {
  try {
    localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY)
  } catch {
    // Nothing to clean up if storage was never reachable in the first place.
  }
}

export async function portalFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const fullUrl = input.startsWith("http") ? input : `${import.meta.env.VITE_BACKEND_URL || ""}${input}`
  const token = getPortalToken()

  return fetch(fullUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
}
