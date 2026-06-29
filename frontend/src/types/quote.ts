import type { Client } from "./client";
import type { Company } from "./company";
import type { PaymentMethod } from "./payment-method";

export enum QuoteStatus {
    DRAFT = "DRAFT",
    SENT = "SENT",
    VIEWED = "VIEWED",
    SIGNED = "SIGNED",
    EXPIRED = "EXPIRED",
}

export interface Quote {
    id: string;
    number?: number; // Assigned at sign (null for DRAFT)
    rawNumber?: string; // Optional raw number for custom formats
    title?: string;
    buyerReference?: string;
    purchaseOrder?: string;
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
    clientId: string;
    client: Client;
    companyId: string;
    company: Company;
    items: QuoteItem[];
    status: QuoteStatus;
    createdAt: Date;
    updatedAt: Date;
    validUntil?: Date;
    signedAt?: Date;
    signatureSvg?: string;
    notes?: string; // Additional notes for the quote
    discountRate?: number;
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
    currency: string; // Currency code, e.g., "EUR", "USD"
    paymentMethodId?: string;
    paymentMethod?: PaymentMethod;
    isActive: boolean;
}

export enum QuoteItemType {
    HOUR = "HOUR",
    DAY = "DAY",
    DEPOSIT = "DEPOSIT",
    SERVICE = "SERVICE",
    PRODUCT = "PRODUCT"
}

export interface QuoteItem {
    id: string;
    quoteId: string;
    type: QuoteItemType;
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    vatRate: number; // 20 for 20%
    order: number; // For sorting items in the quote PDF
    discountRate?: number;
    discountAmount?: number;
    chargeAmount?: number;
    chargeDescription?: string;
    unitOfMeasure?: string;
}
