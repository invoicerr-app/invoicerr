import type { Invoice } from "./invoice";
import type { PaymentMethod } from "./payment-method";

export interface PaymentItem {
    id: string;
    invoiceItemId: string;
    invoiceId: string;
    invoice?: Invoice;
    amountPaid: number;
    paymentId: string;
    payment?: Payment;
}

export interface Payment {
    id: string;
    number: number;
    rawNumber?: string; // Optional raw number for custom formats
    invoiceId: string;
    invoice?: Invoice;
    items: PaymentItem[];
    totalPaid: number;
    paidAt?: string; // ISO date string — when the payment was received
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
    paymentMethodId?: string;
    paymentMethod?: PaymentMethod;
}
