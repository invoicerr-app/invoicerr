import type { finance } from '@fin.cx/einvoice/dist_ts/plugins';

export interface PDFConfigDto {
  fontFamily: string;
  includeLogo: boolean;
  logoB64: string | null;
  padding: number;
  primaryColor: string;
  secondaryColor: string;
  labels: {
    // Generic labels
    receipt: string;
    billTo: string;
    receivedFrom: string;
    invoiceRefer: string;
    paymentDate: string;
    totalReceived: string;

    // Common fields
    description: string;
    dueDate: string;
    date: string;
    grandTotal: string;
    invoice: string;
    quantity: string;
    quote: string;
    quoteFor: string;
    subtotal: string;
    total: string;
    unitPrice: string;
    validUntil: string;
    vat: string;
    vatRate: string;
    notes: string;
    paymentMethod: string;
    paymentDetails: string;

    type: string;
    hour: string;
    day: string;
    deposit: string;
    service: string;
    product: string;

    // Payment method labels (for mapping enum types to display text)
    paymentMethodBankTransfer: string;
    paymentMethodPayPal: string;
    paymentMethodCash: string;
    paymentMethodCheck: string;
    paymentMethodOther: string;

    // Legal fields
    legalId: string;
    VATId: string;
  };
}

export class EditCompanyDto {
  description?: string;
  legalId?: string;
  foundedAt: Date;
  name: string;
  currency: finance.TCurrency;
  VAT?: string;
  exemptVat?: boolean;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  pdfConfig: PDFConfigDto;
  quoteStartingNumber: number;
  quoteNumberFormat: string;
  invoiceStartingNumber: number;
  invoiceNumberFormat: string;
  receiptStartingNumber: number;
  receiptNumberFormat: string;
}
