/**
 * EU Document Builder
 * European e-invoicing with Factur-X, ZUGFeRD, UBL, CII support
 */

import {
  BuilderType,
  BuildResult,
  CreditNoteDocumentData,
  DocumentData,
  DocumentType,
  GenerateDocumentRequest,
  InvoiceDocumentData,
  OutputFormat,
} from '../document.types';

// Type for documents that can be converted to XML (invoices and credit notes)
type XmlCompatibleDocument = InvoiceDocumentData | CreditNoteDocumentData;
import { creditNoteTemplate, invoiceTemplate, quoteTemplate, receiptTemplate } from '../templates';
import { BaseDocumentBuilder } from './base.builder';

/**
 * EU builder for European e-invoicing standards
 * Supports Factur-X, ZUGFeRD, UBL, CII
 */
export class EUDocumentBuilder extends BaseDocumentBuilder {
  readonly type: BuilderType = 'eu';
  readonly supportedFormats: OutputFormat[] = [
    'pdf',
    'facturx',
    'zugferd',
    'ubl',
    'cii',
    'xrechnung',
  ];
  readonly supportedDocuments: DocumentType[] = [
    'invoice',
    'quote',
    'receipt',
    'credit-note',
    'proforma',
    'corrective-invoice',
  ];

  async build(request: GenerateDocumentRequest): Promise<BuildResult> {
    const { type, data, format, pdfConfig } = request;

    // Get the appropriate template
    const templateString = this.getTemplate(type);

    // Build template context
    const labels = pdfConfig?.labels || this.getDefaultLabels();
    const config = pdfConfig || {
      fontFamily: 'Arial',
      padding: 40,
      primaryColor: '#2563eb',
      secondaryColor: '#64748b',
      includeLogo: false,
      labels,
    };

    const context = this.buildTemplateContext(data, config);

    // Add VAT exempt text for EU if applicable
    if (this.isVATExempt(data)) {
      context.vatExemptText = this.getVATExemptText(data);
    }

    // Compile and render HTML
    const template = this.compileTemplate(templateString);
    const html = template(context);

    // Determine if XML should be embedded
    const requiresXmlEmbed = this.requiresXmlEmbed(format);
    const xmlSyntax = this.getXmlSyntax(format);

    // Generate XML if needed
    let xml: string | undefined;
    if (requiresXmlEmbed && (type === 'invoice' || type === 'credit-note')) {
      xml = this.generateXml(data as XmlCompatibleDocument, xmlSyntax);
    }

    return {
      html,
      xml,
      metadata: {
        requiresXmlEmbed,
        xmlSyntax,
      },
    };
  }

  /**
   * Get template string for document type
   */
  private getTemplate(type: DocumentType): string {
    switch (type) {
      case 'invoice':
      case 'corrective-invoice':
      case 'deposit-invoice':
        return invoiceTemplate;
      case 'quote':
      case 'proforma':
        return quoteTemplate;
      case 'receipt':
        return receiptTemplate;
      case 'credit-note':
        return creditNoteTemplate;
      default:
        return invoiceTemplate;
    }
  }

  /**
   * Check if format requires XML embedding
   */
  private requiresXmlEmbed(format: OutputFormat): boolean {
    return ['facturx', 'zugferd', 'xrechnung'].includes(format);
  }

  /**
   * Get XML syntax for format
   */
  private getXmlSyntax(format: OutputFormat): 'ubl' | 'cii' | undefined {
    switch (format) {
      case 'facturx':
      case 'zugferd':
        return 'cii';
      case 'ubl':
      case 'xrechnung':
        return 'ubl';
      default:
        return undefined;
    }
  }

  /**
   * Check if document is VAT exempt
   */
  private isVATExempt(data: DocumentData): boolean {
    return data.totals.totalVAT === 0 && data.totals.totalHT > 0;
  }

  /**
   * Get VAT exempt text based on context
   */
  private getVATExemptText(_data: DocumentData): string {
    // This would be determined by compliance rules in a real implementation
    // For now, return a generic EU text
    return 'TVA non applicable, art. 293 B du CGI';
  }

  /**
   * Generate XML for e-invoicing
   */
  private generateXml(data: XmlCompatibleDocument, syntax: 'ubl' | 'cii' | undefined): string {
    if (syntax === 'cii') {
      return this.generateCII(data);
    } else if (syntax === 'ubl') {
      return this.generateUBL(data);
    }
    return '';
  }

  /**
   * Generate CII XML (Cross-Industry Invoice)
   */
  private generateCII(data: XmlCompatibleDocument): string {
    const supplierVat = data.supplier.identifiers?.vat || '';
    const customerVat = data.customer.identifiers?.vat || '';
    const supplierSiret = data.supplier.identifiers?.siret || '';
    const customerSiret = data.customer.identifiers?.siret || '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:factur-x.eu:1p0:${data.type === 'credit-note' ? 'creditnote' : 'invoice'}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${this.escapeXml(data.number)}</ram:ID>
    <ram:TypeCode>${data.type === 'credit-note' ? '381' : '380'}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${this.formatDateCII(data.createdAt)}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${this.escapeXml(data.supplier.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${this.escapeXml(data.supplier.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${this.escapeXml(data.supplier.address)}</ram:LineOne>
          <ram:CityName>${this.escapeXml(data.supplier.city)}</ram:CityName>
          <ram:CountryID>${this.escapeXml(data.supplier.countryCode || data.supplier.country)}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${supplierVat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${this.escapeXml(supplierVat)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
        ${supplierSiret ? `<ram:SpecifiedLegalOrganization><ram:ID>${this.escapeXml(supplierSiret)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${this.escapeXml(data.customer.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${this.escapeXml(data.customer.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${this.escapeXml(data.customer.address)}</ram:LineOne>
          <ram:CityName>${this.escapeXml(data.customer.city)}</ram:CityName>
          <ram:CountryID>${this.escapeXml(data.customer.countryCode || data.customer.country)}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${customerVat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${this.escapeXml(customerVat)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
        ${customerSiret ? `<ram:SpecifiedLegalOrganization><ram:ID>${this.escapeXml(customerSiret)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${data.currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${data.totals.totalHT.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${data.totals.totalHT.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${data.currency}">${data.totals.totalVAT.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${data.totals.totalTTC.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${data.totals.totalTTC.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
    ${data.items
      .map(
        (item, index) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${index + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${this.escapeXml(item.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${item.unitPrice.toFixed(2)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">${item.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>${item.vatRate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${(item.totalHT ?? item.lineTotal ?? item.quantity * item.unitPrice).toFixed(2)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
      )
      .join('')}
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
  }

  /**
   * Generate UBL XML
   */
  private generateUBL(data: XmlCompatibleDocument): string {
    const supplierVat = data.supplier.identifiers?.vat || '';
    const customerVat = data.customer.identifiers?.vat || '';
    const supplierSiret = data.supplier.identifiers?.siret || '';
    const customerSiret = data.customer.identifiers?.siret || '';

    const docType = data.type === 'credit-note' ? 'CreditNote' : 'Invoice';

    return `<?xml version="1.0" encoding="UTF-8"?>
<${docType} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${docType}-2"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${this.escapeXml(data.number)}</cbc:ID>
  <cbc:IssueDate>${this.formatDateUBL(data.createdAt)}</cbc:IssueDate>
  <cbc:${docType}TypeCode>${data.type === 'credit-note' ? '381' : '380'}</cbc:${docType}TypeCode>
  <cbc:DocumentCurrencyCode>${data.currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(data.supplier.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${this.escapeXml(data.supplier.address)}</cbc:StreetName>
        <cbc:CityName>${this.escapeXml(data.supplier.city)}</cbc:CityName>
        <cbc:PostalZone>${this.escapeXml(data.supplier.postalCode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${this.escapeXml(data.supplier.countryCode || data.supplier.country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${supplierVat ? `<cac:PartyTaxScheme><cbc:CompanyID>${this.escapeXml(supplierVat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      ${supplierSiret ? `<cac:PartyLegalEntity><cbc:RegistrationName>${this.escapeXml(data.supplier.name)}</cbc:RegistrationName><cbc:CompanyID>${this.escapeXml(supplierSiret)}</cbc:CompanyID></cac:PartyLegalEntity>` : ''}
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(data.customer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${this.escapeXml(data.customer.address)}</cbc:StreetName>
        <cbc:CityName>${this.escapeXml(data.customer.city)}</cbc:CityName>
        <cbc:PostalZone>${this.escapeXml(data.customer.postalCode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${this.escapeXml(data.customer.countryCode || data.customer.country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${customerVat ? `<cac:PartyTaxScheme><cbc:CompanyID>${this.escapeXml(customerVat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      ${customerSiret ? `<cac:PartyLegalEntity><cbc:RegistrationName>${this.escapeXml(data.customer.name)}</cbc:RegistrationName><cbc:CompanyID>${this.escapeXml(customerSiret)}</cbc:CompanyID></cac:PartyLegalEntity>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${data.currency}">${data.totals.totalHT.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${data.currency}">${data.totals.totalHT.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.currency}">${data.totals.totalTTC.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.currency}">${data.totals.totalTTC.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${data.items
    .map(
      (item, index) => `
  <cac:${docType}Line>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:${docType === 'CreditNote' ? 'CreditedQuantity' : 'InvoicedQuantity'} unitCode="C62">${item.quantity}</cbc:${docType === 'CreditNote' ? 'CreditedQuantity' : 'InvoicedQuantity'}>
    <cbc:LineExtensionAmount currencyID="${data.currency}">${(item.totalHT ?? item.lineTotal ?? item.quantity * item.unitPrice).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${this.escapeXml(item.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${item.vatRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${data.currency}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:${docType}Line>`,
    )
    .join('')}
</${docType}>`;
  }

  /**
   * Format date for CII (YYYYMMDD)
   */
  private formatDateCII(date: Date): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Format date for UBL (YYYY-MM-DD)
   */
  private formatDateUBL(date: Date): string {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }
}
