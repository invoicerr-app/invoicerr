/**
 * The client portal (TODO_FEATURES.md rank 3) — mirrors the backend's own
 * `client-portal/portal-tokens.service.ts` (staff-facing invite CRUD) and `client-portal/portal.service.ts`
 * (the client-facing read/respond surface) shapes, the same "one interface per backend response shape"
 * convention `types/client.ts` already holds for `ClientStatement`.
 */

/** What `POST /clients/:clientId/portal-access` returns — mirrors the backend's `CreatedPortalAccess`.
 *  `token`/`path` appear here ONLY: the same "shown once" contract `CreatedShareLink` already holds. */
export interface CreatedPortalAccess {
  id: string
  token: string
  path: string
  expiresAt: string
  emailed: boolean
}

/** One row from `GET /clients/:clientId/portal-access` — mirrors the backend's `PortalAccessSummary`.
 *  No `token`/`tokenHash` — re-displaying a past invite's URL is impossible by construction, the same
 *  guarantee `ShareLinkSummary` already holds for a document link. */
export interface PortalAccessSummary {
  id: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  active: boolean
}

/** What `GET /api/portal/me` returns — mirrors the backend's `PortalProfile`. */
export interface PortalProfile {
  clientId: string
  clientName: string
  companyName: string
}

/** One row from `GET /api/portal/quotes` — mirrors the backend's `PortalQuoteRow`. */
export interface PortalQuoteRow {
  id: string
  displayNumber: string | null
  status: string
  issueDate: string | null
  currency: string
  amountMinor: number
  canRespond: boolean
}
