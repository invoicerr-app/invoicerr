import { usePortalApiMutation, usePortalApiQuery } from "@/hooks/use-portal-api-query"

import type { ClientStatement, PortalProfile, PortalQuoteRow } from "@/types"

/**
 * The CLIENT-facing half of the portal — driven exclusively by `usePortalApiQuery`/
 * `usePortalApiMutation` (the bearer-token transport, `use-portal-api-query.ts`), never
 * `useApiQuery`/`useApiMutation`: there is no staff session here, only the token `/portal/[token].tsx`
 * captured. Every call reaches `/api/portal/*`, gated by the backend's own `PortalAuthGuard`.
 */
export function usePortalProfile(enabled: boolean) {
  return usePortalApiQuery<PortalProfile>(["portal", "me"], "/api/portal/me", {
    enabled,
    retry: false,
  })
}

export function usePortalStatement(enabled: boolean) {
  return usePortalApiQuery<ClientStatement>(["portal", "statement"], "/api/portal/statement", {
    enabled,
  })
}

export function usePortalQuotes(enabled: boolean) {
  return usePortalApiQuery<PortalQuoteRow[]>(["portal", "quotes"], "/api/portal/quotes", {
    enabled,
  })
}

const PORTAL_QUOTES_KEY = ["portal", "quotes"]

/** Starts the EXISTING, OTP-hardened signature request (see the backend's own
 *  `PortalService.requestQuoteSignature` header) — never signs anything itself. Invalidates the
 *  quotes list so a caller sees the same row again (still "sent") rather than a stale, pre-request
 *  snapshot; the actual status change only ever happens through `/signature/:token`. */
export function useRequestPortalQuoteSignature() {
  return usePortalApiMutation<{ quoteId: string }, { message: string }>(
    "POST",
    (vars) => `/api/portal/quotes/${vars.quoteId}/request-signature`,
    { invalidateKeys: [PORTAL_QUOTES_KEY] },
  )
}

export function useRefusePortalQuote() {
  return usePortalApiMutation<{ quoteId: string }, { status: string }>(
    "POST",
    (vars) => `/api/portal/quotes/${vars.quoteId}/refuse`,
    { invalidateKeys: [PORTAL_QUOTES_KEY] },
  )
}
