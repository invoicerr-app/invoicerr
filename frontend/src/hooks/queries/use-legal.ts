import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export interface LegalDocumentView {
  slug: string
  title: string
  version: string
  effectiveDate: string
  sidebarPosition: number
  /** Raw markdown — render it yourself (see `lib/legal-markdown.ts`). */
  content: string
}

export interface LegalDocumentsView {
  /** Mirrors `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` (backend's own `billing-flag.ts`) — the
   *  sign-up screen's only signal for whether the acceptance checkbox must be shown at all. */
  saasMode: boolean
  documents: LegalDocumentView[]
}

/** `GET /api/legal/documents` — public, always reachable (even self-hosted, unlike
 *  `GET /api/billing/status`'s own 404-when-absent shape — see that route's own header). */
export function useLegalDocuments() {
  return useApiQuery<LegalDocumentsView>(queryKeys.legal.documents(), "/api/legal/documents", {
    staleTime: 5 * 60_000,
  })
}

export interface LegalStatusView {
  requiresAcceptance: boolean
  pending: string[]
}

/** `GET /api/legal/status` — authenticated; always `{ requiresAcceptance: false, pending: [] }`
 *  outside SaaS mode. `enabled` lets a caller (`(app)/_layout.tsx`) defer the request until a session
 *  actually exists, rather than firing it while `authClient.useSession()` is still pending. */
export function useLegalStatus(enabled = true) {
  return useApiQuery<LegalStatusView>(queryKeys.legal.status(), "/api/legal/status", {
    enabled,
    staleTime: 60_000,
  })
}

/** `POST /api/legal/accept` — omit `slugs` to accept whatever `useLegalStatus` currently reports as
 *  pending (the sign-in re-acceptance interstitial's own call). A no-op outside SaaS mode. */
export function useAcceptLegal() {
  return useApiMutation<{ slugs?: string[] } | undefined, { accepted: string[] }>(
    "POST",
    "/api/legal/accept",
    { invalidateKeys: [queryKeys.legal.status()] },
  )
}
