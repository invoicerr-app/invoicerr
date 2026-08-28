export class UpsertInvoicesDto {
  quoteId?: string;
  clientId: string;
  notes?: string;
  paymentMethod?: string;
  paymentDetails?: string;
  paymentMethodId?: string;
  frequency:
    | 'WEEKLY'
    | 'BIWEEKLY'
    | 'MONTHLY'
    | 'BIMONTHLY'
    | 'QUARTERLY'
    | 'QUADMONTHLY'
    | 'SEMIANNUALLY'
    | 'ANNUALLY';
  count?: number;
  until?: Date;
  autoIssue?: boolean;
  autoSend?: boolean;
  currency?: string;
  items: {
    id?: string;
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    /** Declared BT-151 — only meaningful on a 0% line. See InvoiceItem.requestedVatCategory. */
    vatCategory?: string;
    /** BT-120/BT-121 — why the line is exempt. */
    vatExemptionReason?: string;
    type?: 'HOUR' | 'DAY' | 'DEPOSIT' | 'SERVICE' | 'PRODUCT';
    order: number;
  }[];
}
