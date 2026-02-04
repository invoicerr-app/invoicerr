import { Injectable } from '@nestjs/common';
import { BaseFormatGenerator } from './base.generator';
import { FormatConfig, InvoiceData, FormatResult } from '../../interfaces/format.interface';

/**
 * UBL Generator (Universal Business Language)
 * Used by Peppol, XRechnung (German B2G), and general e-invoicing
 * Version: 2.1, Profile: Basic, PEPPOL BIS 3.0
 */
@Injectable()
export class UBLGenerator extends BaseFormatGenerator {
  readonly name = 'UBL';
  readonly supportedFormats = ['ubl', 'xrechnung', 'peppol-bis'];

  supports(format: string): boolean {
    return this.supportedFormats.includes(format);
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    const profile = config.profile || 'basic';
    const xml = this.generateUBLInvoice(invoice, profile);

    return {
      xml: this.wrapWithDeclaration(xml),
      format: 'ubl',
      mimeType: 'application/xml',
    };
  }

  /**
   * Generate UBL 2.1 Invoice XML
   */
  private generateUBLInvoice(invoice: InvoiceData, profile: string): string {
    const sellerCountry = this.getCountryCode(invoice.supplier.country || 'france');
    const buyerCountry = this.getCountryCode(invoice.customer.country || 'france');
    const currencyCode = invoice.currency || 'EUR';
    const xmlns = this.getNamespace(profile);

    return `<Invoice xmlns="${xmlns.ubl}"
          xmlns:cac="${xmlns.cac}"
          xmlns:cbc="${xmlns.cbc}"
          xmlns:ext="${xmlns.ext}">
  <cbc:ID>${this.escapeXml(invoice.rawNumber || invoice.number || '')}</cbc:ID>
  <cbc:IssueDate>${this.formatDate(invoice.issueDate || new Date())}</cbc:IssueDate>
  <cbc:DueDate>${this.formatDate(invoice.dueDate || invoice.issueDate || new Date())}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currencyCode}</cbc:DocumentCurrencyCode>
  ${invoice.note ? `<cbc:Note>${this.escapeXml(invoice.note)}</cbc:Note>` : ''}
  <cbc:BuyerReference>${this.escapeXml(invoice.reference || '')}</cbc:BuyerReference>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID>${this.escapeXml(invoice.supplier.identifiers?.vat || invoice.supplier.identifiers?.siret || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${this.escapeXml(invoice.supplier.name || '')}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      ${this.buildPostalAddress(invoice.supplier, 'AccountingSupplierParty')}
      ${this.buildContact(invoice.supplier)}
    </cac:Party>
    <cac:PartyTaxScheme>
      <cbc:CompanyID>${this.escapeXml(invoice.supplier.identifiers?.vat || invoice.supplier.identifiers?.siret || '')}</cbc:CompanyID>
      <cbc:TaxSchemeID>${sellerCountry}:VAT</cbc:TaxSchemeID>
    </cac:PartyTaxScheme>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID>${this.escapeXml(invoice.customer.identifiers?.vat || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${this.escapeXml(invoice.customer.name || '')}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      ${this.buildPostalAddress(invoice.customer, 'AccountingCustomerParty')}
      ${this.buildContact(invoice.customer)}
    </cac:Party>
    <cac:PartyTaxScheme>
      <cbc:CompanyID>${this.escapeXml(invoice.customer.identifiers?.vat || '')}</cbc:CompanyID>
      <cbc:TaxSchemeID>${buyerCountry}:VAT</cbc:TaxSchemeID>
    </cac:PartyTaxScheme>
  </cac:AccountingCustomerParty>

  <cac:Delivery>
    ${this.buildPostalAddress(invoice.customer, 'Delivery')}
  </cac:Delivery>

  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    ${invoice.paymentReference ? `<cbc:PaymentID>${this.escapeXml(invoice.paymentReference)}</cbc:PaymentID>` : ''}
  </cac:PaymentMeans>

  <cac:PaymentTerms>
    <cbc:Note>${this.escapeXml(invoice.paymentTerms || 'Net 30 days')}</cbc:Note>
  </cac:PaymentTerms>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currencyCode}">${this.formatAmount(invoice.totals?.vat || 0)}</cbc:TaxAmount>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currencyCode}">${this.formatAmount(invoice.totals?.subtotal || 0)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currencyCode}">${this.formatAmount(invoice.totals?.subtotal || 0)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currencyCode}">${this.formatAmount(invoice.totals?.total || 0)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currencyCode}">${this.formatAmount(invoice.totals?.total || 0)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <cac:InvoiceLine>
    ${invoice.items?.map((item, index) => this.buildInvoiceLine(item, index, currencyCode)).join('\n')}
  </cac:InvoiceLine>
</Invoice>`;
  }

  /**
   * Build postal address block
   */
  private buildPostalAddress(party: any, parent: string): string {
    const country = this.getCountryCode(party.country);
    return `<cac:${parent}>
  <cac:PostalAddress>
    <cbc:StreetName>${this.escapeXml(party.streetName || party.address || '')}</cbc:StreetName>
    ${party.city ? `<cbc:CityName>${this.escapeXml(party.city)}</cbc:CityName>` : ''}
    ${party.postalCode ? `<cbc:PostalZone>${this.escapeXml(party.postalCode)}</cbc:PostalZone>` : ''}
    <cbc:CountrySubentity>${this.escapeXml(party.state || '')}</cbc:CountrySubentity>
    <cac:Country>
      <cbc:IdentificationCode>${country}</cbc:IdentificationCode>
    </cac:Country>
  </cac:PostalAddress>
</cac:${parent}>`;
  }

  /**
   * Build contact block
   */
  private buildContact(party: any): string {
    if (!party.email && !party.phone && !party.fax) return '';
    return `<cac:Contact>
    ${party.email ? `<cbc:ElectronicMail>${this.escapeXml(party.email)}</cbc:ElectronicMail>` : ''}
    ${party.phone ? `<cbc:Telephone>${this.escapeXml(party.phone)}</cbc:Telephone>` : ''}
  </cac:Contact>`;
  }

  /**
   * Build invoice line
   */
  private buildInvoiceLine(item: any, index: number, currencyCode: string): string {
    return `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${this.getUnitCode(item.type)}">${this.formatQuantity(item.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currencyCode}">${this.formatAmount(item.lineTotal)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${this.escapeXml(item.description)}</cbc:Description>
      <cbc:Name>${this.escapeXml(item.description)}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>${this.escapeXml(item.code || `${index + 1}`)}</cbc:ID>
      </cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${this.getVatCategoryCode(item.vatRate)}</cbc:ID>
        <cbc:Percent>${item.vatRate}</cbc:Percent>
        <cbc:TaxSchemeID>${currencyCode.substring(0, 2)}:VAT</cbc:TaxSchemeID>
      </cac:ClassifiedTaxCategory>
      <cac:BasePrice>
        <cbc:PriceAmount currencyID="${currencyCode}">${this.formatAmount(item.unitPrice)}</cbc:PriceAmount>
      </cac:BasePrice>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currencyCode}">${this.formatAmount(item.unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  }

  /**
   * Get VAT category code
   */
  private getVatCategoryCode(rate: number): string {
    if (rate === 0) return 'Z';
    if (rate < 10) return 'S';
    return 'AA';
  }

  /**
   * Get unit code
   */
  private getUnitCode(type?: string): string {
    return type === 'goods' ? 'EA' : 'C62';
  }

  /**
   * Get namespace based on profile
   */
  private getNamespace(profile: string): any {
    return {
      ubl: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    };
  }
}
