import { Injectable } from '@nestjs/common';
import { AbstractCountryCompliance } from '../abstract-country.compliance';
import { InvoiceData } from '../../formats/format.interface';
import { QuoteData, ReceiptData, CreditNoteData, VATContext, VATResult, NumberingContext } from '../country-compliance.interface';
import { VATRate } from '../../interfaces/vat.interface';
import { TransmissionMethod } from '../../interfaces/transmission.interface';

/**
 * France-specific compliance implementation
 * 
 * Features:
 * - Chorus Pro integration for B2G (public sector)
 * - Factur-X format support
 * - SIRET/SIREN validation
 * - French VAT rates (20%, 10%, 5.5%, 2.1%)
 * - Specific legal mentions
 */
@Injectable()
export class FranceCompliance extends AbstractCountryCompliance {
  // Country metadata
  readonly countryCode = 'FR';
  readonly countryName = 'France';
  readonly currency = 'EUR';
  readonly isEU = true;
  readonly locale = 'fr-FR';
  readonly timezone = 'Europe/Paris';

  // VAT Configuration - French VAT rates
  protected readonly vatRates: VATRate[] = [
    { code: 'S', rate: 20, labelKey: 'vat.standard', category: 'S' },
    { code: 'R1', rate: 10, labelKey: 'vat.reduced.10', category: 'AA' },
    { code: 'R2', rate: 5.5, labelKey: 'vat.reduced.5_5', category: 'AA' },
    { code: 'R3', rate: 2.1, labelKey: 'vat.reduced.2_1', category: 'AA' },
    { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
  ];
  protected readonly defaultVatRate = 20;

  // Numbering Configuration
  protected readonly invoicePrefix = 'FA';
  protected readonly quotePrefix = 'DE';
  protected readonly receiptPrefix = 'RE';
  protected readonly numberFormat = /^(FA|DE|RE|AV)\d{4}-\d{6,}$/;

  // Feature Flags
  protected readonly qrCodeRequired = false;
  protected readonly signatureRequired = false;
  protected readonly hashChainRequired = false;

  // Archiving
  protected readonly archivingPeriodYears = 10; // France requires 10 years

  // France-specific constants
  private readonly SIRET_REGEX = /^\d{14}$/;
  private readonly SIREN_REGEX = /^\d{9}$/;
  private readonly VAT_FR_REGEX = /^FR[A-HJ-NP-Z0-9]{11}$/;

  // ============================================
  // Numbering Overrides
  // ============================================

  async generateNextInvoiceNumber(context: NumberingContext): Promise<string> {
    const { year, lastNumber = 0 } = context;
    const currentYear = year || new Date().getFullYear();
    const nextNumber = lastNumber + 1;
    return `${this.invoicePrefix}${currentYear}-${String(nextNumber).padStart(6, '0')}`;
  }

  async generateNextQuoteNumber(context: NumberingContext): Promise<string> {
    const { year, lastNumber = 0 } = context;
    const currentYear = year || new Date().getFullYear();
    const nextNumber = lastNumber + 1;
    return `${this.quotePrefix}${currentYear}-${String(nextNumber).padStart(6, '0')}`;
  }

  async generateNextReceiptNumber(context: NumberingContext): Promise<string> {
    const { year, lastNumber = 0 } = context;
    const currentYear = year || new Date().getFullYear();
    const nextNumber = lastNumber + 1;
    return `${this.receiptPrefix}${currentYear}-${String(nextNumber).padStart(6, '0')}`;
  }

  async generateCreditNoteNumber(originalInvoiceNumber: string): Promise<string> {
    // Replace FA (facture) with AV (avoir)
    if (originalInvoiceNumber.startsWith('FA')) {
      return originalInvoiceNumber.replace(/^FA/, 'AV');
    }
    return `AV-${originalInvoiceNumber}`;
  }

  // ============================================
  // VAT Overrides
  // ============================================

  calculateVAT(items, context: VATContext): VATResult {
    const result = super.calculateVAT(items, context);
    
    // Add French-specific logic for exemptions
    if (context.isIntraEU && context.transactionType === 'B2B') {
      return {
        ...result,
        totalVAT: 0,
        totalTTC: result.totalHT,
        reverseCharge: true,
        reverseChargeText: 'TVA applicable selon l\'article 283-1 du Code Général des Impôts - Autoliquidation',
        vatBreakdown: [
          { rate: 0, baseAmount: result.totalHT, vatAmount: 0 }
        ],
      };
    }

    return result;
  }

  async validateVatNumber(vatNumber: string): Promise<boolean> {
    // Check French format first
    if (!this.VAT_FR_REGEX.test(vatNumber.toUpperCase())) {
      return false;
    }

    // TODO: Call VIES service for validation
    // For now, just validate format
    return true;
  }

  // ============================================
  // Document Generation
  // ============================================

  async generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
    // TODO: Implement French invoice PDF with legal mentions
    throw new Error('French invoice PDF generation not yet implemented');
  }

  async generateQuotePDF(data: QuoteData): Promise<Buffer> {
    // TODO: Implement French quote PDF
    throw new Error('French quote PDF generation not yet implemented');
  }

  async generateReceiptPDF(data: ReceiptData): Promise<Buffer> {
    // TODO: Implement French receipt PDF
    throw new Error('French receipt PDF generation not yet implemented');
  }

  async generateCreditNotePDF(data: CreditNoteData): Promise<Buffer> {
    // TODO: Implement French credit note PDF
    throw new Error('French credit note PDF generation not yet implemented');
  }

  // ============================================
  // E-Invoice (Factur-X)
  // ============================================

  async generateEInvoiceXML(data: InvoiceData, format: string): Promise<string> {
    if (format === 'factur-x') {
      return this.generateFacturX(data);
    } else if (format === 'ubl') {
      return this.generateUBL(data);
    }
    throw new Error(`Unsupported format: ${format}`);
  }

  private generateFacturX(data: InvoiceData): string {
    // Simplified Factur-X (CII syntax) structure
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>A1</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:factur-x.eu:1p0:basic</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${data.number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${data.issueDate.toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${data.supplier.name}</ram:Name>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${data.customer.name}</ram:Name>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${data.currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${data.totalHT.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${data.totalHT.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${data.currency}">${data.totalVAT.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${data.totalTTC.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${data.totalTTC.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
    return xml;
  }

  private generateUBL(data: InvoiceData): string {
    // Standard UBL with French specificities
    return super.generateEInvoiceXML(data, 'ubl');
  }

  getSupportedEInvoiceFormats(): string[] {
    return ['factur-x', 'ubl', 'cii', 'pdf'];
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
      'supplierSIRET', // French specific
      'supplierVAT',
    ];
  }

  getRequiredClientFields(): string[] {
    return [
      'name',
      'email',
      'address',
    ];
  }

  getRequiredCompanyFields(): string[] {
    return [
      'name',
      'address',
      'email',
      'siret', // French specific
      'vatNumber',
    ];
  }

  getLegalMentions(): string[] {
    return [
      'SIRET: {companySiret}',
      'TVA intracommunautaire: {companyVAT}',
      'Code APE: {companyAPE}',
    ];
  }

  // ============================================
  // Identifiers (SIRET/SIREN)
  // ============================================

  validateIdentifier(type: string, value: string): boolean {
    switch (type.toLowerCase()) {
      case 'siret':
        return this.validateSIRET(value);
      case 'siren':
        return this.validateSIREN(value);
      case 'tva':
      case 'vat':
        return this.VAT_FR_REGEX.test(value.toUpperCase());
      default:
        return value.length > 0;
    }
  }

  private validateSIRET(siret: string): boolean {
    if (!this.SIRET_REGEX.test(siret)) {
      return false;
    }
    
    // Luhn validation for SIRET
    return this.validateLuhn(siret);
  }

  private validateSIREN(siren: string): boolean {
    if (!this.SIREN_REGEX.test(siren)) {
      return false;
    }
    
    // Luhn validation for SIREN
    return this.validateLuhn(siren);
  }

  private validateLuhn(value: string): boolean {
    let sum = 0;
    let alternate = false;
    
    for (let i = value.length - 1; i >= 0; i--) {
      let n = parseInt(value.substring(i, i + 1), 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    
    return sum % 10 === 0;
  }

  formatIdentifier(type: string, value: string): string {
    switch (type.toLowerCase()) {
      case 'siret':
        // Format: XXX XXX XXX XXXXX
        return value.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4');
      case 'siren':
        // Format: XXX XXX XXX
        return value.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
      case 'tva':
      case 'vat': {
        // Format: FR XX XXXXXXXX
        const vat = value.toUpperCase().replace(/^FR/, '');
        return `FR ${vat.substring(0, 2)} ${vat.substring(2)}`;
      }
      default:
        return value;
    }
  }

  getSupportedIdentifierTypes(): string[] {
    return ['siret', 'siren', 'vat'];
  }

  // ============================================
  // Transmission
  // ============================================

  getSupportedTransmissionMethods(): TransmissionMethod[] {
    return [
      {
        id: 'email',
        name: 'Email',
        description: 'Envoi par email',
        supported: true,
        mandatory: false,
      },
      {
        id: 'chorus',
        name: 'Chorus Pro',
        description: 'Portail de facturation pour la commande publique',
        supported: true,
        mandatory: false, // Only mandatory for B2G
      },
      {
        id: 'peppol',
        name: 'Peppol',
        description: 'Réseau européen de facturation électronique',
        supported: true,
        mandatory: false,
      },
    ];
  }

  canSendVia(method: string): boolean {
    return ['email', 'chorus', 'peppol'].includes(method.toLowerCase());
  }
}
