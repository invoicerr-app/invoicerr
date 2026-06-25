import type { Client } from "./client";
import type { Company } from "./company";
import type { PaymentMethod } from "./payment-method";

export enum InvoiceStatus {
    DRAFT = 'DRAFT',
    PAID = 'PAID',
    UNPAID = 'UNPAID',
    OVERDUE = 'OVERDUE',
    SENT = 'SENT',
    UPCOMING = 'UPCOMING',
    ARCHIVED = 'ARCHIVED'
}

/**
 * Display-only mapping: UNPAID invoices are shown as SENT in the UI without
 * touching the underlying status stored in the database.
 */
export function getDisplayInvoiceStatus(status: InvoiceStatus | string): InvoiceStatus {
    return status === InvoiceStatus.UNPAID ? InvoiceStatus.SENT : (status as InvoiceStatus)
}

/**
 * Groups raw invoice statuses into the 4 categories filterable from the invoice list:
 * SENT/UNPAID/OVERDUE are grouped under "sent".
 */
export type InvoiceStatusFilterKey = "draft" | "sent" | "paid" | "archived"

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
    description: string;
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
    description: string;
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
    autoSend?: boolean; // Auto-send generated invoices
    nextInvoiceDate?: Date | string; // Date for the next invoice generation
    lastInvoiceDate?: Date | string; // Date of the last generated invoice
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
}
