import type { Client } from "./client";
import type { Company } from "./company";
import type { PaymentMethod } from "./payment-method";

export enum RecurrenceFrequency {
    WEEKLY = 'WEEKLY',
    BIWEEKLY = 'BIWEEKLY',
    MONTHLY = 'MONTHLY',
    BIMONTHLY = 'BIMONTHLY',
    QUARTERLY = 'QUARTERLY',
    QUADMONTHLY = 'QUADMONTHLY',
    SEMIANNUALLY = 'SEMIANNUALLY',
    ANNUALLY = 'ANNUALLY',
}

export interface RecurringInvoiceItem {
    id: string;
    recurringInvoiceId: string;
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    order: number;
}

export interface RecurringInvoice {
    id: string;
    clientId: string;
    companyId: string;
    client: Client;
    company: Company;
    items: RecurringInvoiceItem[];
    paymentMethodId?: string;
    paymentMethod?: PaymentMethod;
    paymentDetails?: string;
    notes?: string;
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
    currency: string;
    frequency: RecurrenceFrequency;
    count?: number;
    until?: string;
    autoIssue: boolean;
    autoSend: boolean;
    paused: boolean;
    skipNext: boolean;
    nextInvoiceDate?: string;
    lastInvoiceDate?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateRecurringInvoiceDto {
    clientId: string;
    currency?: string;
    notes?: string;
    paymentMethodId?: string;
    paymentDetails?: string;
    frequency: RecurrenceFrequency;
    count?: number;
    until?: Date;
    autoIssue?: boolean;
    autoSend?: boolean;
    items: {
        name: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        order?: number;
    }[];
}

export interface UpdateRecurringInvoiceDto extends CreateRecurringInvoiceDto {
    id: string;
}
