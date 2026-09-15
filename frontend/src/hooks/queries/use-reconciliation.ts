import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

/**
 * TODO_FEATURES.md rank 19, second pass ("rapprochement à 3 voies") — mirrors the backend's own
 * `reconciliation/` types verbatim (`three-way-match.ts`'s `LineMatchVerdict`/`ThreeWayMatchLine`,
 * `resolve-received-invoice-reconciliation.ts`'s `ReceivedInvoiceReconciliationResult`,
 * `variance-acceptance.ts`'s `VarianceAcceptance`, `reconciliation-settings.ts`'s
 * `ReconciliationSettings`) — see those files' own headers for the full "why" behind every shape.
 */

/** The engine's own two states, widened with the THIRD a human acceptance can reach. */
export type LineMatchVerdict = "within-tolerance" | "to-review" | "accepted"

export interface ReconciliationLine {
  description: string
  quantityOrdered: number
  quantityReceived: number
  quantityInvoiced: number
  unitPriceOrdered: number | null
  unitPriceInvoiced: number | null
  quantityVarianceValue: number
  quantityVariancePercent: number | null
  priceVarianceValue: number
  priceVariancePercent: number | null
  expectedTotal: number
  invoicedTotal: number
  totalVarianceValue: number
  totalVariancePercent: number | null
  verdict: LineMatchVerdict
}

export interface VarianceAcceptance {
  acceptedByUserId: string
  acceptedByLabel: string
  /** ISO 8601. */
  acceptedAt: string
  reason?: string
}

export type ReconciliationResult =
  | { hasPurchaseOrder: false }
  | {
      hasPurchaseOrder: true
      purchaseOrderId: string
      tolerancePercent: number
      overallVerdict: LineMatchVerdict
      lines: ReconciliationLine[]
      acceptance: VarianceAcceptance | null
    }

/** `GET /api/documents/received-invoices/:id/reconciliation` — see this type's own header. */
export function useReceivedInvoiceReconciliation(documentId: string | undefined) {
  return useApiQuery<ReconciliationResult>(
    ["received-invoice-reconciliation", documentId],
    `/api/documents/received-invoices/${documentId}/reconciliation`,
    { enabled: !!documentId },
  )
}

interface AcceptVarianceVariables {
  documentId: string
  reason?: string
}

/**
 * `POST /api/documents/received-invoices/:id/accept-variance` — OWNER/ADMIN only server-side (the
 * button that calls this is itself hidden for any other role — see `document-reconciliation-section.
 * tsx`'s own header — but the backend is the real gate, the same "the screen refuses what the API
 * would refuse, never only the other way round" discipline this whole module already holds).
 * `invalidateKeys` refetches this same document's reconciliation — the response ALREADY carries the
 * freshly-accepted result, so this is a belt-and-braces refresh, never load-bearing for the screen's
 * own immediate update (the mutation's `data` is rendered directly).
 */
export function useAcceptVariance() {
  return useApiMutation<AcceptVarianceVariables, ReconciliationResult>(
    "POST",
    (vars) => `/api/documents/received-invoices/${vars.documentId}/accept-variance`,
    { invalidateKeys: [["received-invoice-reconciliation"]] },
  )
}

export interface ReconciliationSettings {
  tolerancePercent: number
}

/** `GET /api/documents/received-invoices/reconciliation-settings` — this company's own tolerance. */
export function useReconciliationSettings() {
  return useApiQuery<ReconciliationSettings>(
    ["reconciliation-settings"],
    "/api/documents/received-invoices/reconciliation-settings",
  )
}

/** `PUT /api/documents/received-invoices/reconciliation-settings` — OWNER/ADMIN only server-side. */
export function useSetReconciliationSettings() {
  return useApiMutation<ReconciliationSettings, ReconciliationSettings>(
    "PUT",
    "/api/documents/received-invoices/reconciliation-settings",
    { invalidateKeys: [["reconciliation-settings"]] },
  )
}
