import { Client } from "./client";
import { Company } from "./company";
import { PaymentMethod } from "./payment-method";

export enum InvoiceStatus {
    PAID = 'PAID',
    UNPAID = 'UNPAID',
    OVERDUE = 'OVERDUE',
    SENT = 'SENT'
}

export enum InvoiceItemType {
    HOUR = "HOUR",
    DAY = "DAY",
    DEPOSIT = "DEPOSIT",
    SERVICE = "SERVICE",
    PRODUCT = "PRODUCT"
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
}

export interface Invoice {
    id: string;
    number: number; // Ex: "INV-2025-0001"
    rawNumber?: string; // Optional raw number for custom formats
    title?: string; // Optional title from DTOs
    quoteId?: string;
    clientId: string;
    companyId: string;
    client: Client
    company: Company
    items: InvoiceItem[];
    status: InvoiceStatus;
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
    dueDate: string; // ISO date string
    paidAt?: string; // ISO date string
    paymentMethodId?: string; // Reference to saved payment method
    paymentMethod?: PaymentMethod; // Linked PaymentMethod object
    notes?: string;
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
    currency: string; // Currency code, e.g., "EUR", "USD"
    isActive: boolean;
}
