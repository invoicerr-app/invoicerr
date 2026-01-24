export interface Company {
  id: string;
  description: string;
  foundedAt: Date | string;
  name: string;
  currency: string;
  identifiers: Record<string, string>;
  exemptVat?: boolean;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  quoteStartingNumber: number;
  quoteNumberFormat: string;
  invoiceStartingNumber: number;
  invoiceNumberFormat: string;
  receiptStartingNumber: number;
  receiptNumberFormat: string;
  invoicePDFFormat: string;
  dateFormat: string;
}
