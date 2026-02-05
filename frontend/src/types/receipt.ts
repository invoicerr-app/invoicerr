import type { Invoice } from "./invoice";
import type { PaymentMethod } from "./payment-method";

interface ReceiptItem {
    id: string;
    invoiceItemId: string; // ID of the invoice item this receipt item corresponds to
    invoiceId: string;
    invoice?: Invoice;
    amountPaid: number;
    receiptId: string;
    receipt?: Receipt;
}

export interface Receipt {
    id: string;
    number: number;
    rawNumber?: string; // Optional raw number for custom formats
    invoiceId: string;
    invoice?: Invoice;
    items: ReceiptItem[];
    totalPaid: number;
    createdAt: string; // ISO date string
    updatedAt: string; // ISO date string
    paymentMethodId?: string;
    paymentMethod?: PaymentMethod;
}
