import { Injectable } from '@nestjs/common';
import { CountryComplianceFactory } from './countries';
import {
  CountryCompliance,
  NumberingContext,
  InvoiceItem,
  VATContext,
  VATResult,
  QuoteData,
  ReceiptData,
  CreditNoteData,
} from './countries/country-compliance.interface';
import { InvoiceData } from './formats/format.interface';
import {
  CountrySummaryDto,
  FrontendComplianceConfigDto,
} from './dto/compliance-config.dto';
import { FormatService } from './formats';
import { TransmissionPayload, TransmissionResult, TransmissionStatus } from './interfaces';
import { TransmissionService } from './transmission/transmission.service';

/**
 * Compliance Service
 * 
 * Main service for handling country-specific compliance requirements.
 * Uses the CountryComplianceFactory to get the appropriate compliance
 * implementation for each country.
 * 
 * @example
 * // Get compliance for France
 * const franceCompliance = this.complianceService.getCountryCompliance('FR');
 * 
 * // Generate invoice number
 * const invoiceNumber = await franceCompliance.generateNextInvoiceNumber(context);
 * 
 * // Calculate VAT
 * const vatResult = franceCompliance.calculateVAT(items, context);
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly complianceFactory: CountryComplianceFactory,
    private readonly transmissionService: TransmissionService,
    private readonly formatService: FormatService,
  ) {}

  // ============================================
  // Country Compliance Access
  // ============================================

  /**
   * Get compliance implementation for a specific country
   */
  getCountryCompliance(countryCode: string): CountryCompliance {
    return this.complianceFactory.create(countryCode);
  }

  /**
   * Check if a country is supported
   */
  isCountrySupported(countryCode: string): boolean {
    // All countries are supported via GenericCountryCompliance fallback
    return true;
  }

  /**
   * Check if a country has specific implementation (not just generic)
   */
  hasSpecificImplementation(countryCode: string): boolean {
    return this.complianceFactory.hasSpecificImplementation(countryCode);
  }

  /**
   * Get all supported country codes (with specific implementations)
   */
  getSupportedCountries(): string[] {
    return this.complianceFactory.getSupportedCountries();
  }

  /**
   * Get list of supported countries with summary info
   */
  getAvailableCountries(): CountrySummaryDto[] {
    const supportedCountries = this.complianceFactory.getSupportedCountries();
    const euCountries = this.complianceFactory.getEUCountries();
    
    return supportedCountries.map(code => {
      const compliance = this.getCountryCompliance(code);
      return {
        code: compliance.countryCode,
        name: compliance.countryName,
        currency: compliance.currency,
        isEU: compliance.isEU,
      };
    });
  }

  // ============================================
  // Numbering
  // ============================================

  /**
   * Generate next invoice number for a country
   */
  async generateInvoiceNumber(
    countryCode: string,
    context: NumberingContext,
  ): Promise<string> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateNextInvoiceNumber(context);
  }

  /**
   * Generate next quote number for a country
   */
  async generateQuoteNumber(
    countryCode: string,
    context: NumberingContext,
  ): Promise<string> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateNextQuoteNumber(context);
  }

  /**
   * Generate next receipt number for a country
   */
  async generateReceiptNumber(
    countryCode: string,
    context: NumberingContext,
  ): Promise<string> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateNextReceiptNumber(context);
  }

  /**
   * Generate credit note number for a country
   */
  async generateCreditNoteNumber(
    countryCode: string,
    originalInvoiceNumber: string,
  ): Promise<string> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateCreditNoteNumber(originalInvoiceNumber);
  }

  /**
   * Validate document number format for a country
   */
  validateNumberFormat(
    countryCode: string,
    number: string,
    type: 'invoice' | 'quote' | 'receipt' | 'credit-note',
  ): boolean {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.validateNumberFormat(number, type);
  }

  // ============================================
  // VAT
  // ============================================

  /**
   * Calculate VAT for items in a specific country context
   */
  calculateVAT(
    countryCode: string,
    items: InvoiceItem[],
    context: VATContext,
  ): VATResult {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.calculateVAT(items, context);
  }

  /**
   * Get VAT rates for a country
   */
  getVatRates(countryCode: string) {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getVatRates();
  }

  /**
   * Get VAT rate for a specific category in a country
   */
  getVatRateForCategory(countryCode: string, category: string): number {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getVatRateForCategory(category);
  }

  /**
   * Validate VAT number
   */
  async validateVatNumber(countryCode: string, vatNumber: string): Promise<boolean> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.validateVatNumber(vatNumber);
  }

  // ============================================
  // Document Generation
  // ============================================

  /**
   * Generate invoice PDF for a country
   */
  async generateInvoicePDF(countryCode: string, data: InvoiceData): Promise<Buffer> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateInvoicePDF(data);
  }

  /**
   * Generate quote PDF for a country
   */
  async generateQuotePDF(countryCode: string, data: QuoteData): Promise<Buffer> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateQuotePDF(data);
  }

  /**
   * Generate receipt PDF for a country
   */
  async generateReceiptPDF(countryCode: string, data: ReceiptData): Promise<Buffer> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateReceiptPDF(data);
  }

  /**
   * Generate credit note PDF for a country
   */
  async generateCreditNotePDF(countryCode: string, data: CreditNoteData): Promise<Buffer> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateCreditNotePDF(data);
  }

  /**
   * Generate e-invoice XML for a country
   */
  async generateEInvoiceXML(
    countryCode: string,
    data: InvoiceData,
    format: string,
  ): Promise<string> {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateEInvoiceXML(data, format);
  }

  /**
   * Get supported e-invoice formats for a country
   */
  getSupportedEInvoiceFormats(countryCode: string): string[] {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getSupportedEInvoiceFormats();
  }

  // ============================================
  // Required Fields
  // ============================================

  /**
   * Get required invoice fields for a country
   */
  getRequiredInvoiceFields(countryCode: string): string[] {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getRequiredInvoiceFields();
  }

  /**
   * Get required client fields for a country
   */
  getRequiredClientFields(countryCode: string): string[] {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getRequiredClientFields();
  }

  /**
   * Get required company fields for a country
   */
  getRequiredCompanyFields(countryCode: string): string[] {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getRequiredCompanyFields();
  }

  /**
   * Get legal mentions for a country
   */
  getLegalMentions(countryCode: string): string[] {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getLegalMentions();
  }

  // ============================================
  // Identifiers
  // ============================================

  /**
   * Validate identifier for a country
   */
  validateIdentifier(
    countryCode: string,
    type: string,
    value: string,
  ): boolean {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.validateIdentifier(type, value);
  }

  /**
   * Format identifier for a country
   */
  formatIdentifier(
    countryCode: string,
    type: string,
    value: string,
  ): string {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.formatIdentifier(type, value);
  }

  /**
   * Get supported identifier types for a country
   */
  getSupportedIdentifierTypes(countryCode: string): string[] {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getSupportedIdentifierTypes();
  }

  // ============================================
  // Transmission
  // ============================================

  /**
   * Get supported transmission methods for a country
   */
  getSupportedTransmissionMethods(countryCode: string) {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getSupportedTransmissionMethods();
  }

  /**
   * Check if can send via method for a country
   */
  canSendVia(countryCode: string, method: string): boolean {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.canSendVia(method);
  }

  /**
   * Send invoice using transmission service
   */
  async sendInvoice(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    return this.transmissionService.send(platform, payload);
  }

  /**
   * Check transmission status
   */
  async checkTransmissionStatus(platform: string, externalId: string): Promise<TransmissionStatus> {
    return this.transmissionService.checkStatus(platform, externalId);
  }

  /**
   * Get supported transmission platforms
   */
  getSupportedPlatforms(): string[] {
    return this.transmissionService.getSupportedPlatforms();
  }

  // ============================================
  // Archiving
  // ============================================

  /**
   * Get archiving period for a country
   */
  getArchivingPeriodYears(countryCode: string): number {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.getArchivingPeriodYears();
  }

  // ============================================
  // QR Code / Signature
  // ============================================

  /**
   * Generate QR code for an invoice
   */
  generateQRCode(countryCode: string, data: InvoiceData): string | null {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.generateQRCode(data);
  }

  /**
   * Check if QR code is required for a country
   */
  requiresQRCode(countryCode: string): boolean {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.requiresQRCode();
  }

  /**
   * Check if signature is required for a country
   */
  requiresSignature(countryCode: string): boolean {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.requiresSignature();
  }

  /**
   * Check if hash chain is required for a country
   */
  requiresHashChain(countryCode: string): boolean {
    const compliance = this.getCountryCompliance(countryCode);
    return compliance.requiresHashChain();
  }

  // ============================================
  // Frontend API
  // ============================================

  /**
   * Get compliance config for frontend based on transaction context
   */
  getConfigForFrontend(
    supplierCountry: string,
    customerCountry: string | null,
    transactionType: 'B2B' | 'B2G' | 'B2C',
    nature: 'goods' | 'services' | 'mixed' = 'services',
  ): FrontendComplianceConfigDto {
    const supplierCompliance = this.getCountryCompliance(supplierCountry);
    const customerCompliance = customerCountry ? this.getCountryCompliance(customerCountry) : null;

    const isDomestic = supplierCountry === customerCountry;
    const isIntraEU = supplierCompliance.isEU && !!customerCompliance?.isEU && !isDomestic;
    const isExport = supplierCompliance.isEU && !!customerCompliance && !customerCompliance.isEU;

    // Build VAT context
    const vatContext: VATContext = {
      supplierCountry,
      customerCountry: customerCountry || undefined,
      transactionType,
      isIntraEU,
      isExport,
    };

    return {
      vatRates: supplierCompliance.getVatRates(),
      defaultVatRate: supplierCompliance.getVatRateForCategory('S'),
      reverseCharge: isIntraEU && transactionType === 'B2B',
      reverseChargeTextKey: isIntraEU ? 'compliance.reverseCharge.services' : undefined,
      exemptions: [],
      requiredFields: supplierCompliance.getRequiredInvoiceFields(),
      identifierFormats: supplierCompliance.getSupportedIdentifierTypes().map(type => ({
        type,
        format: 'regex',
      })),
      vatNumberFormat: supplierCompliance.isEU ? '^[A-Z]{2}[0-9A-Z]{8,12}$' : '.*',
      format: {
        preferred: 'pdf',
        supported: supplierCompliance.getSupportedEInvoiceFormats(),
        syntax: 'UBL',
      },
      transmission: {
        methods: supplierCompliance.getSupportedTransmissionMethods(),
        preferred: 'email',
      },
      numbering: {
        seriesRequired: false,
        gapAllowed: true,
        hashChaining: supplierCompliance.requiresHashChain(),
      },
      legalMentionKeys: supplierCompliance.getLegalMentions(),
      identifiers: supplierCompliance.getSupportedIdentifierTypes(),
      customFields: [],
      qrCodeRequired: supplierCompliance.requiresQRCode(),
      signatureRequired: supplierCompliance.requiresSignature(),
      hashChainRequired: supplierCompliance.requiresHashChain(),
      correctionCodes: [],
    };
  }
}
