import { Currency, ItemType } from "../../../../prisma/generated/prisma/client";

export class CreateQuoteDto {
    // number is auto generated
    title?: string;
    buyerReference?: string;
    purchaseOrder?: string;
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
    clientId: string;
    validUntil?: Date;
    currency?: Currency;
    discountRate?: number;
    paymentMethod?: string;
    paymentDetails?: string;
    paymentMethodId?: string;
    notes: string;
    items: {
        description: string;
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

export class EditQuotesDto {
    id: string;
    title?: string;
    buyerReference?: string;
    purchaseOrder?: string;
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
    clientId: string;
    validUntil?: Date;
    currency?: Currency;
    discountRate?: number;
    paymentMethod?: string;
    paymentDetails?: string;
    paymentMethodId?: string;
    items: {
        id?: string; // Optional for new items
        description: string;
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
