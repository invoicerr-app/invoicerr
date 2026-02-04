import type { Invoice } from './invoice';
import type { PaymentMethod } from './payment-method';

interface ReceiptItem {
  id: string;
  invoiceItemId: string;
  invoiceId: string;
  invoice?: Invoice;
  amountPaid: number;
  receiptId: string;
  receipt?: Receipt;
}

export interface Receipt {
  id: string;
  number: number;
  rawNumber?: string;
  invoiceId: string;
  invoice?: Invoice;
  items: ReceiptItem[];
  totalPaid: number;
  createdAt: string;
  updatedAt: string;
  paymentMethodId?: string;
  paymentMethod?: PaymentMethod;
  title?: string;
  currency: string;
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  notes?: string;
  companyId: string;
  isActive?: boolean;
}
