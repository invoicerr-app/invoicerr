import { useApiQuery } from "@/hooks/use-api-query"

export interface FlowDescriptor {
  primaryChannel: { type: string; providerId?: string; feedback: string }
  channelClass: "EMAIL" | "CLEARANCE" | "PEPPOL" | "PORTAL" | "PRINT"
  sendLabelKey: string
  awaiting: "CLEARANCE" | "BUYER_RESPONSE" | "DELIVERY" | null
  pipeline: string[]
  terminal: boolean
  manualActions: string[]
}

export interface AvailableActions {
  invoiceId: string
  status: string
  complianceStatus?: string
  kind?: string
  immutableAfter: string
  correctionModel: string
  cancellation: {
    /** Whether THIS document can be cancelled right now. */
    allowed: boolean
    /** What the COUNTRY permits, which is a different question and the one a user asks first. */
    policy: {
      allowedByCountry: boolean
      windowHours: number | null
      /** The deadline as an instant. Null when the country sets no window, or before issuance. */
      expiresAt: string | null
      requiresAuthorityAck: boolean
      requiresBuyerConsent: boolean
    }
    /**
     * i18n key suffixes, PLURAL. The server used to send one hardcoded English sentence through an
     * `else if`, so a document with both a window and an authority acknowledgement showed only one
     * of them — and no locale could translate either.
     */
    conditions: string[]
  }
  /** Null only when no compliance plan has been resolved yet (a fresh draft). */
  archival: {
    retentionYears: number
    residency: string | null
    archivedForm: string
    integrity: string
  } | null
  obligations: {
    kind: string
    layer: "ISSUANCE" | "RECEPTION" | "ARCHIVAL"
    model: string | null
    blocking: boolean
    deadline: { value: number; unit: "HOURS" | "DAYS" | "YEARS" } | null
    /** Present when the duty is real but its timing was never sourced. Say so; never invent it. */
    openQuestion: string | null
  }[]
  actions: {
    edit: boolean
    issue: boolean
    correct: boolean
    cancel: boolean
    cancelAndReplace: boolean
    send: boolean
    convertToInvoice: boolean
    deposit: boolean
  }
  correctionKinds: string[]
  flow?: FlowDescriptor | null
}

export function useAvailableActions(invoiceId: string | null | undefined) {
  return useApiQuery<AvailableActions>(
    ["invoices", "availableActions", invoiceId ?? ""],
    `/api/invoices/${invoiceId}/available-actions`,
    {
      enabled: !!invoiceId,
    },
  )
}
