import { Injectable } from '@nestjs/common';
import { 
  CountryCompliance, 
  NumberingContext, 
  DocumentType, 
  InvoiceItem, 
  VATContext, 
  VATResult, 
  QuoteData, 
  ReceiptData, 
  CreditNoteData,
} from './country-compliance.interface';
import { InvoiceData } from '../formats/format.interface';
import { VATRate } from '../interfaces/vat.interface';
import { TransmissionMethod } from '../interfaces/transmission.interface';

/**
 * Abstract base class for country compliance implementations
 * Provides common functionality and defines abstract methods for country-specific logic
 */
@Injectable()
export abstract class AbstractCountryCompliance implements CountryCompliance {
  /** ISO 3166-1 alpha-2 country code */
  abstract readonly countryCode: string;
  
  /** Country name */
  abstract readonly countryName: string;
  
  /** Default currency (ISO 4217) */
  abstract readonly currency: string;
  
  /** Is EU member state */
  abstract readonly isEU: boolean;
  
  /** Default locale */
  abstract readonly locale: string;
  
  /** Timezone */
  abstract readonly timezone: string;

  // ============================================
  // VAT Configuration (to be defined by subclasses)
  // ============================================
  
  /** VAT rates available in this country */
  protected abstract readonly vatRates: VATRate[];
  
  /** Default VAT rate percentage */
  protected abstract readonly defaultVatRate: number;

  // ============================================
  // Numbering Configuration
  // ============================================
  
  /** Number prefix for invoices */
  protected abstract readonly invoicePrefix: string;
  
  /** Number prefix for quotes */
  protected abstract readonly quotePrefix: string;
  
  /** Number prefix for receipts */
  protected abstract readonly receiptPrefix: string;
  
  /** Number format (regex pattern for validation) */
  protected abstract readonly numberFormat: RegExp;

  // ============================================
  // Feature Flags
  // ============================================
  
  /** Whether QR code is required */
  protected abstract readonly qrCodeRequired: boolean;
  
  /** Whether digital signature is required */
  protected abstract readonly signatureRequired: boolean;
  
  /** Whether hash chaining is required */
  protected abstract readonly hashChainRequired: boolean;

  // ============================================
  // Archiving
  // ============================================
  
  /** Number of years documents must be archived */
  protected abstract readonly archivingPeriodYears: number;

  // ============================================
  // Numbering Methods
  // ============================================

  /**
   * Generate next invoice number
   * Default: sequential numbering with prefix
   */
  async generateNextInvoiceNumber(context: NumberingContext): Promise<string> {
    const { series, lastNumber = 0 } = context;
    const nextNumber = lastNumber + 1;
    const seriesPart = series ? `${series}-` : '';
    return `${this.invoicePrefix}${seriesPart}${String(nextNumber).padStart(6, '0')}`;
  }

  /**
   * Generate next quote number
   * Default: sequential numbering with prefix
   */
  async generateNextQuoteNumber(context: NumberingContext): Promise<string> {
    const { series, lastNumber = 0 } = context;
    const nextNumber = lastNumber + 1;
    const seriesPart = series ? `${series}-` : '';
    return `${this.quotePrefix}${seriesPart}${String(nextNumber).padStart(6, '0')}`;
  }

  /**
   * Generate next receipt number
   * Default: sequential numbering with prefix
   */
  async generateNextReceiptNumber(context: NumberingContext): Promise<string> {
    const { series, lastNumber = 0 } = context;
    const nextNumber = lastNumber + 1;
    const seriesPart = series ? `${series}-` : '';
    return `${this.receiptPrefix}${seriesPart}${String(nextNumber).padStart(6, '0')}`;
  }

  /**
   * Generate credit note number
   * Default: prefix with original invoice number
   */
  async generateCreditNoteNumber(originalInvoiceNumber: string): Promise<string> {
    return `CN-${originalInvoiceNumber}`;
  }

  /**
   * Validate document number format
   * Default: check against regex pattern
   */
  validateNumberFormat(number: string, type: DocumentType): boolean {
    return this.numberFormat.test(number);
  }

  // ============================================
  // VAT Methods
  // ============================================

  /**
   * Calculate VAT for invoice items
   * Default: standard calculation with line-by-line VAT
   */
  calculateVAT(items: InvoiceItem[], context: VATContext): VATResult {
    const vatBreakdown = new Map<number, { baseAmount: number; vatAmount: number }>();
    let totalHT = 0;
    let totalVAT = 0;

    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
      const vatRate = item.vatRate;
      const vatAmount = lineTotal * (vatRate / 100);

      totalHT += lineTotal;
      totalVAT += vatAmount;

      const existing = vatBreakdown.get(vatRate);
      if (existing) {
        existing.baseAmount += lineTotal;
        existing.vatAmount += vatAmount;
      } else {
        vatBreakdown.set(vatRate, { baseAmount: lineTotal, vatAmount });
      }
    }

    // Round to 2 decimal places
    totalHT = Math.round(totalHT * 100) / 100;
    totalVAT = Math.round(totalVAT * 100) / 100;
    const totalTTC = Math.round((totalHT + totalVAT) * 100) / 100;

    return {
      totalHT,
      totalVAT,
      totalTTC,
      vatBreakdown: Array.from(vatBreakdown.entries()).map(([rate, amounts]) => ({
        rate,
        baseAmount: Math.round(amounts.baseAmount * 100) / 100,
        vatAmount: Math.round(amounts.vatAmount * 100) / 100,
      })),
      reverseCharge: context.isIntraEU && context.transactionType === 'B2B',
    };
  }

  /**
   * Get all VAT rates
   */
  getVatRates(): VATRate[] {
    return [...this.vatRates];
  }

  /**
   * Get VAT rate for category
   */
  getVatRateForCategory(category: string): number {
    const rate = this.vatRates.find(r => r.code === category);
    return rate?.rate ?? this.defaultVatRate;
  }

  /**
   * Validate VAT number
   * Default: basic format validation
   * EU countries should override to call VIES
   */
  async validateVatNumber(vatNumber: string): Promise<boolean> {
    // Basic EU format: 2 letters + numbers
    const euVatPattern = /^[A-Z]{2}[0-9A-Z]{8,12}$/;
    return euVatPattern.test(vatNumber.toUpperCase());
  }

  // ============================================
  // Abstract Document Generation Methods
  // ============================================

  /**
   * Generate invoice PDF - must be implemented by each country
   */
  abstract generateInvoicePDF(data: InvoiceData): Promise<Buffer>;

  /**
   * Generate quote PDF - must be implemented by each country
   */
  abstract generateQuotePDF(data: QuoteData): Promise<Buffer>;

  /**
   * Generate receipt PDF - must be implemented by each country
   */
  abstract generateReceiptPDF(data: ReceiptData): Promise<Buffer>;

  /**
   * Generate credit note PDF - must be implemented by each country
   */
  abstract generateCreditNotePDF(data: CreditNoteData): Promise<Buffer>;

  /**
   * Generate e-invoice XML - must be implemented by each country
   */
  abstract generateEInvoiceXML(data: InvoiceData, format: string): Promise<string>;

  /**
   * Get supported e-invoice formats - must be implemented by each country
   */
  abstract getSupportedEInvoiceFormats(): string[];

  // ============================================
  // Abstract Field Requirements
  // ============================================

  /**
   * Get required invoice fields - must be implemented by each country
   */
  abstract getRequiredInvoiceFields(): string[];

  /**
   * Get required client fields - must be implemented by each country
   */
  abstract getRequiredClientFields(): string[];

  /**
   * Get required company fields - must be implemented by each country
   */
  abstract getRequiredCompanyFields(): string[];

  /**
   * Get legal mentions - must be implemented by each country
   */
  abstract getLegalMentions(): string[];

  // ============================================
  // Abstract Identifier Methods
  // ============================================

  /**
   * Validate identifier - must be implemented by each country
   */
  abstract validateIdentifier(type: string, value: string): boolean;

  /**
   * Format identifier - must be implemented by each country
   */
  abstract formatIdentifier(type: string, value: string): string;

  /**
   * Get supported identifier types - must be implemented by each country
   */
  abstract getSupportedIdentifierTypes(): string[];

  // ============================================
  // Abstract Transmission Methods
  // ============================================

  /**
   * Get supported transmission methods - must be implemented by each country
   */
  abstract getSupportedTransmissionMethods(): TransmissionMethod[];

  /**
   * Check if can send via method - must be implemented by each country
   */
  abstract canSendVia(method: string): boolean;

  // ============================================
  // Archiving
  // ============================================

  /**
   * Get archiving period in years
   */
  getArchivingPeriodYears(): number {
    return this.archivingPeriodYears;
  }

  // ============================================
  // QR Code / Signature
  // ============================================

  /**
   * Generate QR code data
   * Default: null (not required)
   */
  generateQRCode(data: InvoiceData): string | null {
    return null;
  }

  /**
   * Check if QR code is required
   */
  requiresQRCode(): boolean {
    return this.qrCodeRequired;
  }

  /**
   * Check if signature is required
   */
  requiresSignature(): boolean {
    return this.signatureRequired;
  }

  /**
   * Check if hash chain is required
   */
  requiresHashChain(): boolean {
    return this.hashChainRequired;
  }

  // ============================================
  // Optional Transmission Methods
  // ============================================

  /**
   * Send invoice via transmission method
   * Optional - only implement if country has specific transmission requirements
   */
  async sendInvoice?(payload: TransmissionPayload): Promise<TransmissionResult> {
    throw new Error('sendInvoice not implemented for this country');
  }

  /**
   * Check transmission status
   * Optional - only implement if country has specific transmission requirements
   */
  async checkTransmissionStatus?(externalId: string): Promise<TransmissionStatus> {
    throw new Error('checkTransmissionStatus not implemented for this country');
  }
}
