import { Currency, DocumentKind, ItemType } from "../../../../prisma/generated/prisma/client";

export class CreateInvoiceDto {
    clientId: string;
    kind?: DocumentKind;
    correctsInvoiceId?: string;
    depositOfInvoiceId?: string;
    buyerReference?: string;
    purchaseOrder?: string;
    contractRef?: string;
    deliveryDate?: Date;
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
    quoteId?: string;
    recurringInvoiceId?: string;
    recurringPeriodKey?: string;
    dueDate?: Date;
    currency?: Currency;
    discountRate?: number;
    notes: string;
    paymentMethod?: string;
    paymentDetails?: string;
    paymentMethodId?: string;
    items: {
        name: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        type: ItemType;
        order: number;
        discountRate?: number;
        discountAmount?: number;
        chargeAmount?: number;
        chargeDescription?: string;
        unitOfMeasure?: string;
        quoteItemId?: string;
    }[];
}

export class CreateInvoiceFromQuoteItemDto {
    quoteItemId: string;
    quantity: number;
}

export class CreateInvoiceFromQuoteDto {
    quoteId: string;
    items: CreateInvoiceFromQuoteItemDto[];
}

export class EditInvoicesDto {
    id: string;
    kind?: DocumentKind;
    correctsInvoiceId?: string;
    depositOfInvoiceId?: string;
    buyerReference?: string;
    purchaseOrder?: string;
    contractRef?: string;
    deliveryDate?: Date;
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
    quoteId?: string;
    recurringInvoiceId?: string;
    recurringPeriodKey?: string;
    clientId: string;
    dueDate?: Date;
    currency?: Currency;
    discountRate?: number;
    notes: string;
    paymentMethod?: string;
    paymentDetails?: string;
    paymentMethodId?: string;
    items: {
        id?: string; // Optional for new items
        name: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        type: ItemType;
        order: number;
        discountRate?: number;
        discountAmount?: number;
        chargeAmount?: number;
        chargeDescription?: string;
        unitOfMeasure?: string;
    }[];
}
