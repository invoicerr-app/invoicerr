import type { Client } from "./client";
import type { Company } from "./company";
import type { PaymentMethod } from "./payment-method";

export enum InvoiceStatus {
    DRAFT = 'DRAFT',
    ISSUED = 'ISSUED',
    PAID = 'PAID',
    UNPAID = 'UNPAID',
    OVERDUE = 'OVERDUE',
    SENT = 'SENT',
    UPCOMING = 'UPCOMING',
    ARCHIVED = 'ARCHIVED',
    PENDING_CLEARANCE = 'PENDING_CLEARANCE',
    CLEARED = 'CLEARED',
    CANCELLED = 'CANCELLED',
    CORRECTED = 'CORRECTED',
}

/**
 * Display-only mapping: UNPAID invoices are shown as SENT in the UI without
 * touching the underlying status stored in the database.
 */
export function getDisplayInvoiceStatus(status: InvoiceStatus | string): InvoiceStatus {
    return status === InvoiceStatus.UNPAID ? InvoiceStatus.SENT : (status as InvoiceStatus)
}

/**
 * Returns a human-readable label for the invoice kind.
 */
export function getInvoiceKindLabel(kind?: DocumentKind | string): string {
    switch (kind) {
        case DocumentKind.CREDIT_NOTE: return "Credit Note"
        case DocumentKind.DEBIT_NOTE: return "Debit Note"
        case DocumentKind.CORRECTIVE_INVOICE: return "Corrective Invoice"
        case DocumentKind.PROFORMA: return "Proforma"
        case DocumentKind.DEPOSIT: return "Deposit"
        case DocumentKind.FINAL: return "Final"
        case DocumentKind.INVOICE:
        default: return "Invoice"
    }
}

/**
 * Returns a color class for the invoice kind badge.
 */
export function getInvoiceKindColor(kind?: DocumentKind | string): string {
    switch (kind) {
        case DocumentKind.CREDIT_NOTE: return "bg-emerald-100 text-emerald-800"
        case DocumentKind.DEBIT_NOTE: return "bg-orange-100 text-orange-800"
        case DocumentKind.CORRECTIVE_INVOICE: return "bg-blue-100 text-blue-800"
        case DocumentKind.PROFORMA: return "bg-purple-100 text-purple-800"
        case DocumentKind.DEPOSIT: return "bg-yellow-100 text-yellow-800"
        default: return ""
    }
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

export enum InvoiceItemType {
    HOUR = "HOUR",
    DAY = "DAY",
    DEPOSIT = "DEPOSIT",
    SERVICE = "SERVICE",
    PRODUCT = "PRODUCT"
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
    id: string;
    invoiceId: string;
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    vatRate: number; // 20 for 20%
    type: InvoiceItemType;
    order: number;
    discountRate?: number;
    discountAmount?: number;
    chargeAmount?: number;
    chargeDescription?: string;
    unitOfMeasure?: string;
    quoteItemId?: string; // Link to the originating QuoteItem when created from a quote
}

export interface Invoice {
    id: string;
    number?: number; // Assigned at issue (null for DRAFT)
    rawNumber?: string; // Optional raw number for custom formats
    kind?: DocumentKind;
    correctsInvoiceId?: string;
    depositOfInvoiceId?: string;
    buyerReference?: string;
    purchaseOrder?: string;
    contractRef?: string;
    deliveryDate?: string;
    deliveryAddress?: string;
    deliveryAddressLine2?: string;
    deliveryPostalCode?: string;
    deliveryCity?: string;
    deliveryState?: string;
    deliveryCountry?: string;
    paymentTerms?: string;
    paymentMeansCode?: string;
    fxRate?: number;
    fxTaxAmount?: number;
    ttcPricing?: boolean;
    title?: string; // Optional title from DTOs
    quoteId?: string;
    recurringInvoiceId?: string;
    clientId: string;
    companyId: string;
    client: Client
    company: Company
    items: InvoiceItem[];
    status: InvoiceStatus;
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
    issuedAt?: string; // ISO date string — set at DRAFT→ISSUED transition
    dueDate: string; // ISO date string
    paidAt?: string; // ISO date string
    paymentMethodId?: string; // Reference to saved payment method
    paymentMethod?: PaymentMethod; // Linked PaymentMethod object
    notes?: string;
    discountRate?: number;
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
    currency: string; // Currency code, e.g., "EUR", "USD"
    isActive: boolean;
    payments?: { id: string; totalPaid: number }[];
    correctedBy?: Invoice[];
    depositInvoices?: Invoice[];
    complianceDocuments?: {
        id: string;
        status: string;
        number?: string;
        plan?: { confidence?: string; warnings?: string[] };
        immutableHash?: string;
    }[];
}

export enum RecurrenceFrequency {
    WEEKLY = 'WEEKLY',
    BIWEEKLY = 'BIWEEKLY',
    MONTHLY = 'MONTHLY',
    BIMONTHLY = 'BIMONTHLY',
    QUARTERLY = 'QUARTERLY',
    QUADMONTHLY = 'QUADMONTHLY',
    SEMIANNUALLY = 'SEMIANNUALLY',
    ANNUALLY = 'ANNUALLY'
}

export interface RecurringInvoiceItem {
    id: string;
    recurringInvoiceId: string;
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    vatRate: number; // 20 for 20%
    type: InvoiceItemType;
    order: number;
}

export interface RecurringInvoice {
    id: string;
    clientId: string;
    client: Client;
    companyId: string;
    company: Company;
    items: RecurringInvoiceItem[];
    paymentMethodId?: string;
    paymentMethod?: PaymentMethod; // Linked PaymentMethod object
    notes?: string;
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
    currency: string; // Currency code, e.g., "EUR", "USD"
    frequency: RecurrenceFrequency; // Simplified recurrence frequency
    count?: number; // Number of occurrences, null for infinite
    until?: Date | string; // ISO date string for end date of the recurrence
    autoIssue?: boolean; // Auto-issue generated invoices (assigns number)
    autoSend?: boolean; // Auto-send generated invoices
    paused?: boolean; // Pause generation
    skipNext?: boolean; // Skip the next cycle
    nextInvoiceDate?: Date | string; // Date for the next invoice generation
    lastInvoiceDate?: Date | string; // Date of the last generated invoice
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
}
