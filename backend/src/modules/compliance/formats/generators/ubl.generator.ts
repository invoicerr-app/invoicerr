import { Injectable } from '@nestjs/common';
import { FormatConfig } from '../../interfaces/format.interface';
import { FormatResult, InvoiceData } from '../format.interface';
import { BaseFormatGenerator } from './base.generator';

/**
 * UBL 2.1 Invoice Generator
 * Base format for Peppol BIS 3.0 and many European CIUS
 *
 * Supports:
 * - Peppol BIS Billing 3.0
 * - XRechnung (DE)
 * - NLCIUS (NL)
 * - EHF (NO)
 * - Generic EN16931 compliant
 */
@Injectable()
export class UBLGenerator extends BaseFormatGenerator {
  readonly name = 'ubl';
  readonly supportedFormats = ['ubl', 'peppol', 'xrechnung', 'nlcius', 'ehf'];

  // XML Namespaces
  private readonly NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
  private readonly NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
  private readonly NS_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';

  supports(format: string): boolean {
    return this.supportedFormats.includes(format.toLowerCase());
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    try {
      const xml = this.buildInvoice(invoice, config);
      return {
        success: true,
        xml: this.wrapWithDeclaration(xml),
        format: config.preferred,
        syntax: 'UBL',
        version: '2.1',
      };
    } catch (error) {
      this.logger.error('UBL generation failed:', error);
      return {
        success: false,
        format: config.preferred,
        syntax: 'UBL',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildInvoice(invoice: InvoiceData, config: FormatConfig): string {
    const customizationId = config.customizationId ||
      'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
    const profileId = config.profileId ||
      'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

    const vatBreakdown = this.calculateVatBreakdown(invoice.items);

    return `<Invoice xmlns="${this.NS_INVOICE}"
  xmlns:cac="${this.NS_CAC}"
  xmlns:cbc="${this.NS_CBC}">
  <cbc:CustomizationID>${this.escapeXml(customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${this.escapeXml(profileId)}</cbc:ProfileID>
  <cbc:ID>${this.escapeXml(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${this.formatDate(invoice.issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${this.formatDate(invoice.dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${invoice.notes ? `<cbc:Note>${this.escapeXml(invoice.notes)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
  ${invoice.purchaseOrderReference ? this.buildOrderReference(invoice.purchaseOrderReference) : ''}
  ${this.buildSupplierParty(invoice.supplier)}
  ${this.buildCustomerParty(invoice.customer)}
  ${invoice.paymentMethod ? this.buildPaymentMeans(invoice) : ''}
  ${this.buildPaymentTerms(invoice)}
  ${vatBreakdown.map((vat) => this.buildTaxTotal(vat, invoice.currency)).join('\n  ')}
  ${this.buildLegalMonetaryTotal(invoice)}
  ${invoice.items.map((item, idx) => this.buildInvoiceLine(item, idx + 1, invoice.currency)).join('\n  ')}
</Invoice>`;
  }

  private buildOrderReference(reference: string): string {
    return `<cac:OrderReference>
    <cbc:ID>${this.escapeXml(reference)}</cbc:ID>
  </cac:OrderReference>`;
  }

  private buildSupplierParty(supplier: InvoiceData['supplier']): string {
    const address = this.buildAddressData(supplier);
    return `<cac:AccountingSupplierParty>
    <cac:Party>
      ${supplier.peppolId ? `<cbc:EndpointID schemeID="0088">${this.escapeXml(supplier.peppolId)}</cbc:EndpointID>` : ''}
      ${this.buildPartyIdentification(supplier)}
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(supplier.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${this.escapeXml(address.streetName)}</cbc:StreetName>
        <cbc:CityName>${this.escapeXml(address.cityName)}</cbc:CityName>
        <cbc:PostalZone>${this.escapeXml(address.postalZone)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${address.countryCode}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${supplier.vatNumber ? this.buildPartyTaxScheme(supplier.vatNumber) : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${this.escapeXml(supplier.name)}</cbc:RegistrationName>
        ${supplier.legalId ? `<cbc:CompanyID>${this.escapeXml(supplier.legalId)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
      ${supplier.email ? `<cac:Contact><cbc:ElectronicMail>${this.escapeXml(supplier.email)}</cbc:ElectronicMail></cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingSupplierParty>`;
  }

  private buildCustomerParty(customer: InvoiceData['customer']): string {
    const address = this.buildAddressData(customer);
    return `<cac:AccountingCustomerParty>
    <cac:Party>
      ${customer.peppolId ? `<cbc:EndpointID schemeID="0088">${this.escapeXml(customer.peppolId)}</cbc:EndpointID>` : ''}
      ${this.buildPartyIdentification(customer)}
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(customer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${this.escapeXml(address.streetName)}</cbc:StreetName>
        <cbc:CityName>${this.escapeXml(address.cityName)}</cbc:CityName>
        <cbc:PostalZone>${this.escapeXml(address.postalZone)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${address.countryCode}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${customer.vatNumber ? this.buildPartyTaxScheme(customer.vatNumber) : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${this.escapeXml(customer.name)}</cbc:RegistrationName>
        ${customer.legalId ? `<cbc:CompanyID>${this.escapeXml(customer.legalId)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
      ${customer.email ? `<cac:Contact><cbc:ElectronicMail>${this.escapeXml(customer.email)}</cbc:ElectronicMail></cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>`;
  }

  private buildPartyIdentification(party: InvoiceData['supplier'] | InvoiceData['customer']): string {
    if (!party.legalId) return '';
    return `<cac:PartyIdentification>
        <cbc:ID>${this.escapeXml(party.legalId)}</cbc:ID>
      </cac:PartyIdentification>`;
  }

  private buildPartyTaxScheme(vatNumber: string): string {
    return `<cac:PartyTaxScheme>
        <cbc:CompanyID>${this.escapeXml(vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`;
  }

  private buildPaymentMeans(invoice: InvoiceData): string {
    // 30 = Credit transfer, 58 = SEPA, 31 = Debit transfer
    const paymentMeansCode = '30';
    return `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>${paymentMeansCode}</cbc:PaymentMeansCode>
    ${invoice.paymentTerms ? `<cbc:PaymentID>${this.escapeXml(invoice.paymentTerms)}</cbc:PaymentID>` : ''}
  </cac:PaymentMeans>`;
  }

  private buildPaymentTerms(invoice: InvoiceData): string {
    const days = Math.ceil(
      (invoice.dueDate.getTime() - invoice.issueDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    return `<cac:PaymentTerms>
    <cbc:Note>Payment due in ${days} days</cbc:Note>
  </cac:PaymentTerms>`;
  }

  private buildTaxTotal(
    vat: { rate: number; taxableAmount: number; taxAmount: number },
    currency: string,
  ): string {
    const categoryCode = this.getVatCategoryCode(vat.rate);
    return `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${this.formatAmount(vat.taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${this.formatAmount(vat.taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${this.formatAmount(vat.taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${categoryCode}</cbc:ID>
        <cbc:Percent>${this.formatAmount(vat.rate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;
  }

  private buildLegalMonetaryTotal(invoice: InvoiceData): string {
    return `<cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${this.formatAmount(invoice.totalHT)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${this.formatAmount(invoice.totalHT)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${this.formatAmount(invoice.totalTTC)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency}">${this.formatAmount(invoice.totalTTC)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
  }

  private buildInvoiceLine(item: InvoiceLineItem, lineNumber: number, currency: string): string {
    const categoryCode = this.getVatCategoryCode(item.vatRate);
    const unitCode = item.unitCode || this.getUnitCode(item.itemType);

    return `<cac:InvoiceLine>
    <cbc:ID>${lineNumber}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${unitCode}">${this.formatQuantity(item.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${this.formatAmount(item.lineTotal)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${this.escapeXml(item.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${categoryCode}</cbc:ID>
        <cbc:Percent>${this.formatAmount(item.vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${this.formatAmount(item.unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  }
}
