import { Injectable } from '@nestjs/common';
import { AbstractCountryCompliance } from '../abstract-country.compliance';
import { InvoiceData } from '../../formats/format.interface';
import { QuoteData, ReceiptData, CreditNoteData, VATContext, VATResult, NumberingContext } from '../country-compliance.interface';
import { VATRate } from '../../interfaces/vat.interface';
import { TransmissionMethod } from '../../interfaces/transmission.interface';

/**
 * Germany-specific compliance implementation
 * 
 * Features:
 * - ZUGFeRD 2.2 format support
 * - XRechnung format for B2G
 * - Leitweg-ID for public sector
 * - German VAT rates (19%, 7%)
 * - USt-IdNr validation
 */
@Injectable()
export class GermanyCompliance extends AbstractCountryCompliance {
  // Country metadata
  readonly countryCode = 'DE';
  readonly countryName = 'Germany';
  readonly currency = 'EUR';
  readonly isEU = true;
  readonly locale = 'de-DE';
  readonly timezone = 'Europe/Berlin';

  // VAT Configuration - German VAT rates
  protected readonly vatRates: VATRate[] = [
    { code: 'S', rate: 19, labelKey: 'vat.standard', category: 'S' },
    { code: 'R', rate: 7, labelKey: 'vat.reduced', category: 'AA' },
    { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
  ];
  protected readonly defaultVatRate = 19;

  // Numbering Configuration
  protected readonly invoicePrefix = 'RE';
  protected readonly quotePrefix = 'AN';
  protected readonly receiptPrefix = 'BE';
  protected readonly numberFormat = /^(RE|AN|BE)-\d{4}-\d{6,}$/;

  // Feature Flags
  protected readonly qrCodeRequired = false;
  protected readonly signatureRequired = false;
  protected readonly hashChainRequired = false;

  // Archiving
  protected readonly archivingPeriodYears = 10; // Germany requires 10 years

  // Germany-specific constants
  private readonly VAT_DE_REGEX = /^DE\d{9}$/;
  private readonly LEITWEG_ID_REGEX = /^\d{1,30}$/;

  // ============================================
  // Numbering Overrides
  // ============================================

  async generateNextInvoiceNumber(context: NumberingContext): Promise<string> {
    const { year, lastNumber = 0 } = context;
    const currentYear = year || new Date().getFullYear();
    const nextNumber = lastNumber + 1;
    return `${this.invoicePrefix}-${currentYear}-${String(nextNumber).padStart(6, '0')}`;
  }

  async generateNextQuoteNumber(context: NumberingContext): Promise<string> {
    const { year, lastNumber = 0 } = context;
    const currentYear = year || new Date().getFullYear();
    const nextNumber = lastNumber + 1;
    return `${this.quotePrefix}-${currentYear}-${String(nextNumber).padStart(6, '0')}`;
  }

  async generateNextReceiptNumber(context: NumberingContext): Promise<string> {
    const { year, lastNumber = 0 } = context;
    const currentYear = year || new Date().getFullYear();
    const nextNumber = lastNumber + 1;
    return `${this.receiptPrefix}-${currentYear}-${String(nextNumber).padStart(6, '0')}`;
  }

  async generateCreditNoteNumber(originalInvoiceNumber: string): Promise<string> {
    // Replace RE (Rechnung) with GS (Gutschrift)
    if (originalInvoiceNumber.startsWith('RE-')) {
      return originalInvoiceNumber.replace(/^RE/, 'GS');
    }
    return `GS-${originalInvoiceNumber}`;
  }

  // ============================================
  // VAT Overrides
  // ============================================

  calculateVAT(items, context: VATContext): VATResult {
    const result = super.calculateVAT(items, context);
    
    // Add German-specific logic for intra-EU B2B
    if (context.isIntraEU && context.transactionType === 'B2B') {
      return {
        ...result,
        totalVAT: 0,
        totalTTC: result.totalHT,
        reverseCharge: true,
        reverseChargeText: 'Steuerfreie innergemeinschaftliche Lieferung/Leistung § 4 Nr. 1b UStG',
        vatBreakdown: [
          { rate: 0, baseAmount: result.totalHT, vatAmount: 0 }
        ],
      };
    }

    return result;
  }

  async validateVatNumber(vatNumber: string): Promise<boolean> {
    // Check German format first
    if (!this.VAT_DE_REGEX.test(vatNumber.toUpperCase())) {
      return false;
    }

    // TODO: Call BZSt (German tax authority) or VIES for validation
    // For now, just validate format
    return true;
  }

  // ============================================
  // Document Generation
  // ============================================

  async generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
    // TODO: Implement German invoice PDF with legal mentions
    throw new Error('German invoice PDF generation not yet implemented');
  }

  async generateQuotePDF(data: QuoteData): Promise<Buffer> {
    // TODO: Implement German quote PDF
    throw new Error('German quote PDF generation not yet implemented');
  }

  async generateReceiptPDF(data: ReceiptData): Promise<Buffer> {
    // TODO: Implement German receipt PDF
    throw new Error('German receipt PDF generation not yet implemented');
  }

  async generateCreditNotePDF(data: CreditNoteData): Promise<Buffer> {
    // TODO: Implement German credit note PDF
    throw new Error('German credit note PDF generation not yet implemented');
  }

  // ============================================
  // E-Invoice (ZUGFeRD / XRechnung)
  // ============================================

  async generateEInvoiceXML(data: InvoiceData, format: string): Promise<string> {
    switch (format.toLowerCase()) {
      case 'zugferd':
      case 'zugferd-2.2':
        return this.generateZUGFeRD(data);
      case 'xrechnung':
      case 'xrechnung-2.0':
        return this.generateXRechnung(data);
      case 'ubl':
        return this.generateUBL(data);
      default:
        throw new Error(`Unsupported format for Germany: ${format}`);
    }
  }

  private generateZUGFeRD(data: InvoiceData): string {
    // ZUGFeRD 2.2 uses CII syntax (same as Factur-X)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:zugferd.de:2p2:extended</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${data.number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${data.issueDate.toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:IncludedNote>
      <ram:Content>Rechnung gemäß ZUGFeRD 2.2</ram:Content>
    </ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${data.supplier.name}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${data.supplier.address}</ram:LineOne>
          <ram:CityName>${data.supplier.city}</ram:CityName>
          <ram:PostcodeCode>${data.supplier.postalCode}</ram:PostcodeCode>
          <ram:CountryID>${data.supplier.country}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${data.supplier.vatNumber ? `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${data.supplier.vatNumber}</ram:ID>
        </ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${data.customer.name}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${data.customer.address}</ram:LineOne>
          <ram:CityName>${data.customer.city}</ram:CityName>
          <ram:PostcodeCode>${data.customer.postalCode}</ram:PostcodeCode>
          <ram:CountryID>${data.customer.country}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${data.customer.vatNumber ? `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${data.customer.vatNumber}</ram:ID>
        </ram:SpecifiedTaxRegistration>` : ''}
        ${data.customer.routingCode ? `<ram:URIUniversalCommunication>
          <ram:URIID schemeID="0204">${data.customer.routingCode}</ram:URIID>
        </ram:URIUniversalCommunication>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${data.currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>${data.paymentTerms || 'Zahlbar sofort'}</ram:Description>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${data.dueDate.toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${data.totalHT.toFixed(2)}</ram:LineTotalAmount>
        <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
        <ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${data.totalHT.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${data.currency}">${data.totalVAT.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${data.totalTTC.toFixed(2)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>0.00</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${data.totalTTC.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
    return xml;
  }

  private generateXRechnung(data: InvoiceData): string {
    // XRechnung is a stricter subset of ZUGFeRD
    // Uses UBL syntax instead of CII
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_2.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${data.number}</cbc:ID>
  <cbc:IssueDate>${data.issueDate.toISOString().split('T')[0]}</cbc:IssueDate>
  <cbc:DueDate>${data.dueDate.toISOString().split('T')[0]}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>Rechnung</cbc:Note>
  <cbc:DocumentCurrencyCode>${data.currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${data.purchaseOrderReference || 'NONREF'}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${data.supplier.name}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${data.supplier.address}</cbc:StreetName>
        <cbc:CityName>${data.supplier.city}</cbc:CityName>
        <cbc:PostalZone>${data.supplier.postalCode}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${data.supplier.country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${data.supplier.vatNumber || 'DE123456789'}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${data.customer.name}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${data.customer.address}</cbc:StreetName>
        <cbc:CityName>${data.customer.city}</cbc:CityName>
        <cbc:PostalZone>${data.customer.postalCode}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${data.customer.country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${data.customer.vatNumber ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${data.customer.vatNumber}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      ${data.customer.routingCode ? `<cac:PartyIdentification>
        <cbc:ID schemeID="0204">${data.customer.routingCode}</cbc:ID>
      </cac:PartyIdentification>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentTerms>
    <cbc:Note>${data.paymentTerms || 'Zahlbar sofort ohne Abzug'}</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${data.currency}">${data.totalVAT.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${data.currency}">${data.totalHT.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${data.currency}">${data.totalHT.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.currency}">${data.totalTTC.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.currency}">${data.totalTTC.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
    return xml;
  }

  private generateUBL(data: InvoiceData): string {
    return super.generateEInvoiceXML(data, 'ubl');
  }

  getSupportedEInvoiceFormats(): string[] {
    return ['zugferd', 'zugferd-2.2', 'xrechnung', 'xrechnung-2.0', 'ubl', 'cii', 'pdf'];
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
      'supplierVAT', // USt-IdNr
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
      'vatNumber', // USt-IdNr
      'taxNumber', // Steuernummer
    ];
  }

  getLegalMentions(): string[] {
    return [
      'USt-IdNr: {companyVAT}',
      'Steuernummer: {companyTaxNumber}',
      'Gerichtsstand: {companyCourt}',
      'Geschäftsführer: {companyDirector}',
    ];
  }

  // ============================================
  // Identifiers (USt-IdNr, Leitweg-ID)
  // ============================================

  validateIdentifier(type: string, value: string): boolean {
    switch (type.toLowerCase()) {
      case 'vat':
      case 'ustidnr':
        return this.VAT_DE_REGEX.test(value.toUpperCase());
      case 'leitwegid':
      case 'leitweg-id':
        return this.LEITWEG_ID_REGEX.test(value);
      case 'steuernummer':
      case 'taxnumber':
        // German tax number format varies by state (Bundesland)
        // Basic validation: 10-13 digits
        return /^\d{10,13}$/.test(value);
      default:
        return value.length > 0;
    }
  }

  formatIdentifier(type: string, value: string): string {
    switch (type.toLowerCase()) {
      case 'vat':
      case 'ustidnr':
        // Format: DE 123 456 789
        return value.toUpperCase().replace(/^(DE)(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
      case 'leitwegid':
      case 'leitweg-id':
        // Leitweg-ID has no specific formatting
        return value;
      case 'steuernummer':
      case 'taxnumber':
        // Steuernummer format varies by state, return as-is
        return value;
      default:
        return value;
    }
  }

  getSupportedIdentifierTypes(): string[] {
    return ['vat', 'ustidnr', 'leitwegid', 'leitweg-id', 'steuernummer', 'taxnumber'];
  }

  // ============================================
  // Transmission
  // ============================================

  getSupportedTransmissionMethods(): TransmissionMethod[] {
    return [
      {
        id: 'email',
        name: 'E-Mail',
        description: 'Versand per E-Mail',
        supported: true,
        mandatory: false,
      },
      {
        id: 'peppol',
        name: 'Peppol',
        description: 'Elektronische Rechnung über Peppol-Netzwerk',
        supported: true,
        mandatory: false, // Mandatory for B2G since 2020
      },
      {
        id: 'de-mail',
        name: 'DE-Mail',
        description: 'Deutsche E-Mail-Alternative',
        supported: true,
        mandatory: false,
      },
    ];
  }

  canSendVia(method: string): boolean {
    return ['email', 'peppol', 'de-mail'].includes(method.toLowerCase());
  }
}
