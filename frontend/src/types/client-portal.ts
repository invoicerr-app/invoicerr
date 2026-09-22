/**
 * The client portal — mirrors the backend's own
 * `client-portal/portal-tokens.service.ts` (staff-facing invite CRUD) and `client-portal/portal.service.ts`
 * (the client-facing read/respond surface) shapes, the same "one interface per backend response shape"
 * convention `types/client.ts` already holds for `ClientStatement`.
 */

/** WHY the invite email was, or was not, sent — mirrors the backend's `PortalInviteEmailStatus`.
 *  `"no_contact_email"` and `"send_failed"` both leave `emailed` false but need DIFFERENT screen
 *  text: the first is a client-record gap, the second is unrelated to this client (e.g. SMTP down). */
export type PortalInviteEmailStatus = "sent" | "no_contact_email" | "send_failed"

/** What `POST /clients/:clientId/portal-access` returns — mirrors the backend's `CreatedPortalAccess`.
 *  `token`/`path` appear here ONLY: the same "shown once" contract `CreatedShareLink` already holds. */
export interface CreatedPortalAccess {
  id: string
  token: string
  path: string
  expiresAt: string
  emailed: boolean
  emailStatus: PortalInviteEmailStatus
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
  /** The issuing company's own branding logo as a `data:` URI, or `null` when it never uploaded one —
   *  see the backend's own `PortalProfile.companyLogo` header for why it is inlined rather than
   *  served from a URL the portal's bearer-token page could never authenticate against. */
  companyLogo: string | null
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

/** What `POST /api/portal/documents/invoice/:id/checkout-session` returns — mirrors the backend's
 *  `InvoiceCheckoutSessionResult`, the online-payment checkout session. Nothing but a URL:
 *  the payment page itself is the provider's own hosted surface, never rendered by this app. */
export interface PortalCheckoutSession {
  checkoutUrl: string
}
