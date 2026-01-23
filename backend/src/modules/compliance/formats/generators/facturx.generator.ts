import { Injectable } from '@nestjs/common';
import { FormatConfig } from '../../interfaces/format.interface';
import { FormatResult, InvoiceData } from '../format.interface';
import { BaseFormatGenerator } from './base.generator';

/**
 * Factur-X / ZUGFeRD Generator
 * Based on UN/CEFACT Cross-Industry Invoice (CII) D16B
 *
 * Supports:
 * - Factur-X (FR) - EN16931 compliant
 * - ZUGFeRD 2.2 (DE) - Same as Factur-X
 *
 * Profiles:
 * - MINIMUM: Basic info (invoice number, date, amounts)
 * - BASIC WL: Without line items
 * - BASIC: With simplified line items
 * - EN16931 (COMFORT): Full EN16931 compliance
 * - EXTENDED: Additional fields beyond EN16931
 */
@Injectable()
export class FacturXGenerator extends BaseFormatGenerator {
  readonly name = 'facturx';
  readonly supportedFormats = ['facturx', 'zugferd', 'cii'];

  // CII Namespaces
  private readonly NS_RSM =
    'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
  private readonly NS_QDT =
    'urn:un:unece:uncefact:data:standard:QualifiedDataType:100';
  private readonly NS_RAM =
    'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
  private readonly NS_UDT =
    'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100';

  supports(format: string): boolean {
    return this.supportedFormats.includes(format.toLowerCase());
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    try {
      const profile = config.profile || 'EN16931';
      const xml = this.buildCrossIndustryInvoice(invoice, profile);
      return {
        success: true,
        xml: this.wrapWithDeclaration(xml),
        format: config.preferred,
        syntax: 'CII',
        version: 'D16B',
      };
    } catch (error) {
      this.logger.error('Factur-X generation failed:', error);
      return {
        success: false,
        format: config.preferred,
        syntax: 'CII',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildCrossIndustryInvoice(invoice: InvoiceData, profile: string): string {
    const guidelineId = this.getGuidelineId(profile);
    const vatBreakdown = this.calculateVatBreakdown(invoice.items);

    return `<rsm:CrossIndustryInvoice xmlns:rsm="${this.NS_RSM}"
  xmlns:qdt="${this.NS_QDT}"
  xmlns:ram="${this.NS_RAM}"
  xmlns:udt="${this.NS_UDT}">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guidelineId}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${this.escapeXml(invoice.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${this.formatDateCII(invoice.issueDate)}</udt:DateTimeString>
    </ram:IssueDateTime>
    ${invoice.notes ? `<ram:IncludedNote><ram:Content>${this.escapeXml(invoice.notes)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${this.buildHeaderTradeAgreement(invoice)}
    ${this.buildHeaderTradeDelivery(invoice)}
    ${this.buildHeaderTradeSettlement(invoice, vatBreakdown)}
    ${invoice.items.map((item, idx) => this.buildTradeLineItem(item, idx + 1)).join('\n    ')}
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
  }

  private getGuidelineId(profile: string): string {
    const profiles: Record<string, string> = {
      MINIMUM: 'urn:factur-x.eu:1p0:minimum',
      BASIC_WL: 'urn:factur-x.eu:1p0:basicwl',
      BASIC: 'urn:factur-x.eu:1p0:basic',
      EN16931: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931',
      EXTENDED: 'urn:factur-x.eu:1p0:extended',
    };
    return profiles[profile.toUpperCase()] || profiles.EN16931;
  }

  /**
   * Format date as YYYYMMDD for CII format 102
   */
  private formatDateCII(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private buildHeaderTradeAgreement(invoice: InvoiceData): string {
    return `<ram:ApplicableHeaderTradeAgreement>
      ${invoice.purchaseOrderReference ? `<ram:BuyerReference>${this.escapeXml(invoice.purchaseOrderReference)}</ram:BuyerReference>` : ''}
      ${this.buildSellerTradeParty(invoice.supplier)}
      ${this.buildBuyerTradeParty(invoice.customer)}
    </ram:ApplicableHeaderTradeAgreement>`;
  }

  private buildSellerTradeParty(supplier: InvoiceData['supplier']): string {
    const countryCode = this.getCountryCode(supplier.country);
    return `<ram:SellerTradeParty>
        ${supplier.legalId ? `<ram:ID>${this.escapeXml(supplier.legalId)}</ram:ID>` : ''}
        <ram:Name>${this.escapeXml(supplier.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${this.escapeXml(supplier.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${this.escapeXml(supplier.address)}</ram:LineOne>
          <ram:CityName>${this.escapeXml(supplier.city)}</ram:CityName>
          <ram:CountryID>${countryCode}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${supplier.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${this.escapeXml(supplier.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${supplier.vatNumber ? this.buildTaxRegistration(supplier.vatNumber) : ''}
      </ram:SellerTradeParty>`;
  }

  private buildBuyerTradeParty(customer: InvoiceData['customer']): string {
    const countryCode = this.getCountryCode(customer.country);
    return `<ram:BuyerTradeParty>
        ${customer.legalId ? `<ram:ID>${this.escapeXml(customer.legalId)}</ram:ID>` : ''}
        <ram:Name>${this.escapeXml(customer.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${this.escapeXml(customer.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${this.escapeXml(customer.address)}</ram:LineOne>
          <ram:CityName>${this.escapeXml(customer.city)}</ram:CityName>
          <ram:CountryID>${countryCode}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${customer.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${this.escapeXml(customer.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${customer.vatNumber ? this.buildTaxRegistration(customer.vatNumber) : ''}
      </ram:BuyerTradeParty>`;
  }

  private buildTaxRegistration(vatNumber: string): string {
    return `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${this.escapeXml(vatNumber)}</ram:ID>
        </ram:SpecifiedTaxRegistration>`;
  }

  private buildHeaderTradeDelivery(invoice: InvoiceData): string {
    return `<ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">${this.formatDateCII(invoice.issueDate)}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>`;
  }

  private buildHeaderTradeSettlement(
    invoice: InvoiceData,
    vatBreakdown: Array<{ rate: number; taxableAmount: number; taxAmount: number }>,
  ): string {
    return `<ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${invoice.currency}</ram:InvoiceCurrencyCode>
      ${this.buildPaymentMeans()}
      ${vatBreakdown.map((vat) => this.buildTradeTax(vat)).join('\n      ')}
      ${this.buildTradeSettlementSummation(invoice)}
    </ram:ApplicableHeaderTradeSettlement>`;
  }

  private buildPaymentMeans(): string {
    // 30 = Credit transfer (virement bancaire)
    return `<ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
      </ram:SpecifiedTradeSettlementPaymentMeans>`;
  }

  private buildTradeTax(vat: { rate: number; taxableAmount: number; taxAmount: number }): string {
    const categoryCode = this.getVatCategoryCode(vat.rate);
    return `<ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${this.formatAmount(vat.taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${this.formatAmount(vat.taxableAmount)}</ram:BasisAmount>
        <ram:CategoryCode>${categoryCode}</ram:CategoryCode>
        <ram:RateApplicablePercent>${this.formatAmount(vat.rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
  }

  private buildTradeSettlementSummation(invoice: InvoiceData): string {
    return `<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${this.formatAmount(invoice.totalHT)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${this.formatAmount(invoice.totalHT)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${invoice.currency}">${this.formatAmount(invoice.totalVAT)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${this.formatAmount(invoice.totalTTC)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${this.formatAmount(invoice.totalTTC)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>`;
  }

  private buildTradeLineItem(item: InvoiceData['items'][0], lineNumber: number): string {
    const categoryCode = this.getVatCategoryCode(item.vatRate);
    const unitCode = item.unitCode || this.getUnitCode(item.itemType);

    return `<ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${lineNumber}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${this.escapeXml(item.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${this.formatAmount(item.unitPrice)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${unitCode}">${this.formatQuantity(item.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${categoryCode}</ram:CategoryCode>
          <ram:RateApplicablePercent>${this.formatAmount(item.vatRate)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${this.formatAmount(item.lineTotal)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  }
}
