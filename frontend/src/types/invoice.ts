import type { Client } from "./client"
import type { Company } from "./company"

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  PAID = "PAID",
  UNPAID = "UNPAID",
  OVERDUE = "OVERDUE",
  SENT = "SENT",
  UPCOMING = "UPCOMING",
  ARCHIVED = "ARCHIVED",
  PENDING_CLEARANCE = "PENDING_CLEARANCE",
  CLEARED = "CLEARED",
  // F-008: an authority rejection (KSeF, SdI scarto, PDP). Written only by the backend's
  // compliance projection, never by a user action — but it MUST be listed here, because the
  // status-to-filter mapping falls through to "sent", so an unmodelled status silently reads
  // as a successfully sent invoice. That fallthrough is the finding.
  REJECTED = "REJECTED",
  // The two siblings of REJECTED, distinct facts the user acts on differently: REFUSED is the
  // BUYER declining a correctly transmitted invoice, TRANSMISSION_FAILED never reached the
  // authority at all and is retryable.
  REFUSED = "REFUSED",
  TRANSMISSION_FAILED = "TRANSMISSION_FAILED",
  CANCELLED = "CANCELLED",
  CORRECTED = "CORRECTED",
}

/**
 * Groups raw invoice statuses into filterable categories from the invoice list.
 * SENT/UNPAID/OVERDUE are grouped under "sent".
 * PENDING_CLEARANCE/CLEARED are placeholders (~) for clearance countries (PART X).
 */
export type InvoiceStatusFilterKey =
  | "draft"
  | "issued"
  | "sent"
  | "paid"
  | "archived"
  | "cancelled"
  | "corrected"
  // ~ placeholders for clearance countries (PART X)
  | "pending_clearance"
  | "cleared"
  | "rejected"

export enum InvoiceItemType {
  HOUR = "HOUR",
  DAY = "DAY",
  DEPOSIT = "DEPOSIT",
  SERVICE = "SERVICE",
  PRODUCT = "PRODUCT",
}

export enum DocumentKind {
  INVOICE = "INVOICE",
  CREDIT_NOTE = "CREDIT_NOTE",
  DEBIT_NOTE = "DEBIT_NOTE",
  CORRECTIVE_INVOICE = "CORRECTIVE_INVOICE",
  PROFORMA = "PROFORMA",
  DEPOSIT = "DEPOSIT",
  FINAL = "FINAL",
}

export interface InvoiceItem {
  id: string
  invoiceId: string
  name: string
  description?: string
  quantity: number
  unitPrice: number
  vatRate: number // 20 for 20%
  /** EN 16931 BT-151 as the ENGINE resolved it — read-only here. */
  vatCategory?: string | null
  vatExemptionReason?: string | null
  /** What the ISSUER declared, which is what the form edits. Distinct from the two above: one is
   *  the answer, the other the question, and reloading the form must restore the question. */
  requestedVatCategory?: "E" | "Z" | "O" | null
  requestedVatExemptionReason?: string | null
  type: InvoiceItemType
  order: number
  discountRate?: number
  discountAmount?: number
  chargeAmount?: number
  chargeDescription?: string
  unitOfMeasure?: string
  quoteItemId?: string // Link to the originating QuoteItem when created from a quote
}

export interface Invoice {
  id: string
  number?: number // Assigned at issue (null for DRAFT)
  rawNumber?: string // Optional raw number for custom formats
  kind?: DocumentKind
  correctsInvoiceId?: string
  depositOfInvoiceId?: string
  buyerReference?: string
  purchaseOrder?: string
  contractRef?: string
  deliveryDate?: string
  deliveryAddress?: string
  deliveryAddressLine2?: string
  deliveryPostalCode?: string
  deliveryCity?: string
  deliveryState?: string
  deliveryCountry?: string
  paymentTerms?: string
  paymentMeansCode?: string
  fxRate?: number
  fxTaxAmount?: number
  ttcPricing?: boolean
  title?: string // Optional title from DTOs
  quoteId?: string
  recurringInvoiceId?: string
  clientId: string
  companyId: string
  client: Client
  company: Company
  items: InvoiceItem[]
  status: InvoiceStatus
  createdAt: string // ISO date string
  updatedAt: string // ISO date string
  issuedAt?: string // ISO date string — set at DRAFT→ISSUED transition
  dueDate: string // ISO date string
  paidAt?: string // ISO date string
  notes?: string
  discountRate?: number
  totalHT: number
  totalVAT: number
  totalTTC: number
  currency: string // Currency code, e.g., "EUR", "USD"
  isActive: boolean
  payments?: { id: string; totalPaid: number }[]
  correctedBy?: Invoice[]
  depositInvoices?: Invoice[]
  /**
   * Backend-driven action flags (GET /invoices list mapping — same helper as
   * GET /invoices/:id/available-actions). Absent on lightweight payloads
   * (e.g. dashboard latestInvoices).
   */
  actions?: {
    edit: boolean
    issue: boolean
    correct: boolean
    cancel: boolean
    cancelAndReplace: boolean
    send: boolean
    convertToInvoice: boolean
    deposit: boolean
  }
  complianceDocuments?: {
    id: string
    status: string
    number?: string
    plan?: { confidence?: string; warnings?: string[] }
    immutableHash?: string
    events?: { type: string; at: string; actor?: string; detail?: string }[]
    flow?: {
      channelClass: "EMAIL" | "CLEARANCE" | "PEPPOL" | "PORTAL" | "PRINT"
      sendLabelKey: string
      awaiting: "CLEARANCE" | "BUYER_RESPONSE" | "DELIVERY" | null
      pipeline: string[]
      manualActions?: string[]
    }
  }[]
}

export enum RecurrenceFrequency {
  WEEKLY = "WEEKLY",
  BIWEEKLY = "BIWEEKLY",
  MONTHLY = "MONTHLY",
  BIMONTHLY = "BIMONTHLY",
  QUARTERLY = "QUARTERLY",
  QUADMONTHLY = "QUADMONTHLY",
  SEMIANNUALLY = "SEMIANNUALLY",
  ANNUALLY = "ANNUALLY",
}

export interface RecurringInvoiceItem {
  id: string
  recurringInvoiceId: string
  name: string
  description?: string
  quantity: number
  unitPrice: number
  vatRate: number // 20 for 20%
  /** Declared on the template, carried onto every invoice it generates. */
  requestedVatCategory?: "E" | "Z" | "O" | null
  requestedVatExemptionReason?: string | null
  type: InvoiceItemType
  order: number
}

/**
 * Lightweight summary of an invoice generated from a recurring invoice
 * (shape of the backend `getRecurringInvoice` include).
 */
export interface GeneratedInvoiceSummary {
  id: string
  number?: number | null
  rawNumber?: string | null
  status: InvoiceStatus | string
  totalTTC: number
  currency: string
  createdAt: string
  issuedAt?: string | null
}

export interface RecurringInvoice {
  id: string
  clientId: string
  client: Client
  companyId: string
  company: Company
  items: RecurringInvoiceItem[]
  notes?: string
  totalHT: number
  totalVAT: number
  totalTTC: number
  currency: string // Currency code, e.g., "EUR", "USD"
  frequency: RecurrenceFrequency // Simplified recurrence frequency
  count?: number // Number of occurrences, null for infinite
  until?: Date | string // ISO date string for end date of the recurrence
  autoIssue?: boolean // Auto-issue generated invoices (assigns number)
  autoSend?: boolean // Auto-send generated invoices
  paused?: boolean // Pause generation
  skipNext?: boolean // Skip the next cycle
  nextInvoiceDate?: Date | string // Date for the next invoice generation
  lastInvoiceDate?: Date | string // Date of the last generated invoice
  createdAt: string // ISO date string
  updatedAt: string // ISO date string
  generatedInvoices?: GeneratedInvoiceSummary[] // Present on the detail endpoint
  _count?: { generatedInvoices: number } // Prisma count include
}
