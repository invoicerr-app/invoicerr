import { Injectable } from '@nestjs/common';
import { AbstractCountryCompliance } from './abstract-country.compliance';
import { InvoiceData } from '../formats/format.interface';
import { QuoteData, ReceiptData, CreditNoteData } from './country-compliance.interface';
import { VATRate } from '../interfaces/vat.interface';
import { TransmissionMethod } from '../interfaces/transmission.interface';

/**
 * Generic fallback compliance implementation
 * Used when no specific country implementation exists
 * Provides basic functionality with standard 20% VAT
 */
@Injectable()
export class GenericCountryCompliance extends AbstractCountryCompliance {
  // Country metadata
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: string;
  readonly isEU: boolean;
  readonly locale: string;
  readonly timezone: string;

  // VAT Configuration
  protected readonly vatRates: VATRate[] = [
    { code: 'S', rate: 20, labelKey: 'vat.standard', category: 'S' },
    { code: 'R', rate: 10, labelKey: 'vat.reduced', category: 'AA' },
    { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
  ];
  protected readonly defaultVatRate = 20;

  // Numbering Configuration
  protected readonly invoicePrefix = 'INV-';
  protected readonly quotePrefix = 'QUO-';
  protected readonly receiptPrefix = 'REC-';
  protected readonly numberFormat = /^[A-Z]{3}-\d{6,}$/;

  // Feature Flags
  protected readonly qrCodeRequired = false;
  protected readonly signatureRequired = false;
  protected readonly hashChainRequired = false;

  // Archiving
  protected readonly archivingPeriodYears = 7;

  constructor(countryCode = 'XX') {
    super();
    this.countryCode = countryCode.toUpperCase();
    this.countryName = `Country ${this.countryCode}`;
    this.currency = 'EUR';
    this.isEU = false;
    this.locale = 'en-US';
    this.timezone = 'UTC';
  }

  // ============================================
  // Document Generation (Basic PDF generation)
  // ============================================

  async generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
    // Basic implementation - returns empty buffer
    // In a real implementation, this would generate a PDF
    // For now, we'll throw to indicate it needs implementation
    throw new Error(`Invoice PDF generation not implemented for generic country ${this.countryCode}`);
  }

  async generateQuotePDF(data: QuoteData): Promise<Buffer> {
    throw new Error(`Quote PDF generation not implemented for generic country ${this.countryCode}`);
  }

  async generateReceiptPDF(data: ReceiptData): Promise<Buffer> {
    throw new Error(`Receipt PDF generation not implemented for generic country ${this.countryCode}`);
  }

  async generateCreditNotePDF(data: CreditNoteData): Promise<Buffer> {
    throw new Error(`Credit note PDF generation not implemented for generic country ${this.countryCode}`);
  }

  // ============================================
  // E-Invoice Generation
  // ============================================

  async generateEInvoiceXML(data: InvoiceData, format: string): Promise<string> {
    // Basic UBL XML structure
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${data.number}</cbc:ID>
  <cbc:IssueDate>${data.issueDate.toISOString().split('T')[0]}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${data.currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:Name>${data.supplier.name}</cbc:Name>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:Name>${data.customer.name}</cbc:Name>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${data.currency}">${data.totalHT}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${data.currency}">${data.totalHT}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.currency}">${data.totalTTC}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.currency}">${data.totalTTC}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
    return xml;
  }

  getSupportedEInvoiceFormats(): string[] {
    return ['ubl', 'pdf'];
  }

  // ============================================
  // Required Fields
  // ============================================

  getRequiredInvoiceFields(): string[] {
    return [
      'clientId',
      'items',
      'dueDate',
      'supplierName',
      'supplierAddress',
    ];
  }

  getRequiredClientFields(): string[] {
    return [
      'name',
      'email',
    ];
  }

  getRequiredCompanyFields(): string[] {
    return [
      'name',
      'address',
      'email',
    ];
  }

  getLegalMentions(): string[] {
    return [];
  }

  // ============================================
  // Identifiers
  // ============================================

  validateIdentifier(type: string, value: string): boolean {
    // Generic validation - accept any non-empty string
    return value.length > 0;
  }

  formatIdentifier(type: string, value: string): string {
    // No formatting by default
    return value;
  }

  getSupportedIdentifierTypes(): string[] {
    return [];
  }

  // ============================================
  // Transmission
  // ============================================

  getSupportedTransmissionMethods(): TransmissionMethod[] {
    return [
      {
        id: 'email',
        name: 'Email',
        description: 'Send via email',
        supported: true,
        mandatory: false,
      },
    ];
  }

  canSendVia(method: string): boolean {
    return method === 'email';
  }
}
