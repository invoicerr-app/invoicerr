import { FormatConfig } from '../interfaces/format.interface';

/**
 * Invoice data structure for format generation
 */
export interface InvoiceData {
  // Invoice details
  id: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  currency: string;

  // Amounts
  totalHT: number;
  totalVAT: number;
  totalTTC: number;

  // Parties
  supplier: PartyData;
  customer: PartyData;

  // Line items
  items: InvoiceLineItem[];

  // Optional
  notes?: string;
  paymentTerms?: string;
  paymentMethod?: string;
  purchaseOrderReference?: string;

  // Country-specific
  hash?: string; // ES/PT hash chain
  qrCode?: string; // QR code data
  platformId?: string; // KSeF ID, IRN, MARK, etc.
}

export interface PartyData {
  name: string;
  vatNumber?: string;
  legalId?: string; // SIRET, NIF, Codice Fiscale, etc.
  address: string;
  postalCode: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  email?: string;
  phone?: string;

  // Peppol/routing
  peppolId?: string;
  routingCode?: string; // Codice Destinatario, Leitweg-ID, etc.
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatAmount: number;
  lineTotal: number;
  itemType?: 'goods' | 'services';
  unitCode?: string; // UN/ECE Recommendation 20 (C62, HUR, etc.)
}

/**
 * Result of format generation
 */
export interface FormatResult {
  success: boolean;
  xml?: string;
  format: string;
  syntax: string;
  version?: string;
  error?: string;
  validationErrors?: string[];
}

/**
 * Format generator interface
 * Each format (Factur-X, UBL, FatturaPA, etc.) implements this
 */
export interface FormatGenerator {
  /** Format name */
  readonly name: string;

  /** Supported format identifiers */
  readonly supportedFormats: string[];

  /** Check if this generator supports a format */
  supports(format: string): boolean;

  /** Generate XML from invoice data */
  generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult>;

  /** Validate generated XML (optional) */
  validate?(xml: string): Promise<{ valid: boolean; errors: string[] }>;
}
