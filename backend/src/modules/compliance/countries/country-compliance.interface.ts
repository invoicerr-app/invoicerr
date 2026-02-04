import { InvoiceData, PartyData, InvoiceLineItem } from '../formats/format.interface';
import { VATRate } from '../interfaces/vat.interface';
import { TransmissionMethod, TransmissionPayload, TransmissionResult, TransmissionStatus } from '../interfaces/transmission.interface';

/**
 * Context for document numbering
 */
export interface NumberingContext {
  companyId: string;
  series?: string;
  lastNumber?: number;
  year?: number;
  month?: number;
}

/**
 * Document type for numbering
 */
export type DocumentType = 'invoice' | 'quote' | 'receipt' | 'credit-note';

/**
 * Invoice item for VAT calculation
 */
export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatAmount?: number;
  lineTotal?: number;
  itemType?: 'goods' | 'services';
}

/**
 * Context for VAT calculation
 */
export interface VATContext {
  supplierCountry: string;
  customerCountry?: string;
  transactionType: 'B2B' | 'B2G' | 'B2C';
  isIntraEU: boolean;
  isExport: boolean;
}

/**
 * Result of VAT calculation
 */
export interface VATResult {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  vatBreakdown: Array<{
    rate: number;
    baseAmount: number;
    vatAmount: number;
  }>;
  reverseCharge?: boolean;
  reverseChargeText?: string;
}

/**
 * Quote data for PDF generation
 */
export interface QuoteData {
  id: string;
  number: string;
  issueDate: Date;
  validUntil: Date;
  currency: string;
  supplier: PartyData;
  customer: PartyData;
  items: InvoiceLineItem[];
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  notes?: string;
  paymentTerms?: string;
}

/**
 * Receipt data for PDF generation
 */
export interface ReceiptData {
  id: string;
  number: string;
  issueDate: Date;
  paymentDate: Date;
  currency: string;
  supplier: PartyData;
  customer: PartyData;
  items: InvoiceLineItem[];
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  invoiceRef?: string;
  invoiceNumber?: string;
  paymentMethod?: string;
  notes?: string;
}

/**
 * Credit note data for PDF generation
 */
export interface CreditNoteData {
  id: string;
  number: string;
  issueDate: Date;
  currency: string;
  supplier: PartyData;
  customer: PartyData;
  items: InvoiceLineItem[];
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  originalInvoiceRef: string;
  originalInvoiceNumber: string;
  correctionCode?: string;
  correctionReason?: string;
  notes?: string;
}

/**
 * Main interface for country-specific compliance implementations
 * Each country must implement this interface to provide its specific
 * compliance requirements for invoicing.
 */
export interface CountryCompliance {
  /** ISO 3166-1 alpha-2 country code */
  readonly countryCode: string;
  
  /** Country name */
  readonly countryName: string;
  
  /** Default currency (ISO 4217) */
  readonly currency: string;
  
  /** Is EU member state */
  readonly isEU: boolean;
  
  /** Default locale */
  readonly locale: string;
  
  /** Timezone */
  readonly timezone: string;

  // ============================================
  // Numbering
  // ============================================

  /**
   * Generate next invoice number based on context
   */
  generateNextInvoiceNumber(context: NumberingContext): Promise<string>;

  /**
   * Generate next quote number based on context
   */
  generateNextQuoteNumber(context: NumberingContext): Promise<string>;

  /**
   * Generate next receipt number based on context
   */
  generateNextReceiptNumber(context: NumberingContext): Promise<string>;

  /**
   * Generate credit note number from original invoice number
   */
  generateCreditNoteNumber(originalInvoiceNumber: string): Promise<string>;

  /**
   * Validate if a document number format is valid for this country
   */
  validateNumberFormat(number: string, type: DocumentType): boolean;

  // ============================================
  // VAT
  // ============================================

  /**
   * Calculate VAT for invoice items
   */
  calculateVAT(items: InvoiceItem[], context: VATContext): VATResult;

  /**
   * Get available VAT rates for this country
   */
  getVatRates(): VATRate[];

  /**
   * Get VAT rate for a specific category
   */
  getVatRateForCategory(category: string): number;

  /**
   * Validate a VAT number (may check VIES for EU countries)
   */
  validateVatNumber(vatNumber: string): Promise<boolean>;

  // ============================================
  // Document Generation
  // ============================================

  /**
   * Generate invoice PDF
   */
  generateInvoicePDF(data: InvoiceData): Promise<Buffer>;

  /**
   * Generate quote PDF
   */
  generateQuotePDF(data: QuoteData): Promise<Buffer>;

  /**
   * Generate receipt PDF
   */
  generateReceiptPDF(data: ReceiptData): Promise<Buffer>;

  /**
   * Generate credit note PDF
   */
  generateCreditNotePDF(data: CreditNoteData): Promise<Buffer>;

  /**
   * Generate e-invoice XML in specified format
   */
  generateEInvoiceXML(data: InvoiceData, format: string): Promise<string>;

  /**
   * Get list of supported e-invoice formats
   */
  getSupportedEInvoiceFormats(): string[];

  // ============================================
  // Required Fields
  // ============================================

  /**
   * Get required fields for invoices
   */
  getRequiredInvoiceFields(): string[];

  /**
   * Get required fields for clients
   */
  getRequiredClientFields(): string[];

  /**
   * Get required fields for company setup
   */
  getRequiredCompanyFields(): string[];

  /**
   * Get legal mentions required on documents
   */
  getLegalMentions(): string[];

  // ============================================
  // Identifiers
  // ============================================

  /**
   * Validate a country-specific identifier
   */
  validateIdentifier(type: string, value: string): boolean;

  /**
   * Format an identifier for display
   */
  formatIdentifier(type: string, value: string): string;

  /**
   * Get list of supported identifier types
   */
  getSupportedIdentifierTypes(): string[];

  // ============================================
  // Transmission
  // ============================================

  /**
   * Get supported transmission methods
   */
  getSupportedTransmissionMethods(): TransmissionMethod[];

  /**
   * Check if transmission via method is supported
   */
  canSendVia(method: string): boolean;

  /**
   * Send invoice via transmission method
   */
  sendInvoice?(payload: TransmissionPayload): Promise<TransmissionResult>;

  /**
   * Check transmission status
   */
  checkTransmissionStatus?(externalId: string): Promise<TransmissionStatus>;

  // ============================================
  // Archiving
  // ============================================

  /**
   * Get required archiving period in years
   */
  getArchivingPeriodYears(): number;

  // ============================================
  // QR Code / Signature
  // ============================================

  /**
   * Generate QR code data for invoice
   */
  generateQRCode(data: InvoiceData): string | null;

  /**
   * Check if QR code is required on invoices
   */
  requiresQRCode(): boolean;

  /**
   * Check if digital signature is required
   */
  requiresSignature(): boolean;

  /**
   * Check if hash chaining is required
   */
  requiresHashChain(): boolean;
}
