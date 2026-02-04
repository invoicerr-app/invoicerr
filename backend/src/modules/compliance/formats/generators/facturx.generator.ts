import { Injectable } from '@nestjs/common';
import { BaseFormatGenerator } from './base.generator';
import { FormatConfig, InvoiceData, FormatResult } from '../../interfaces/format.interface';

/**
 * Factur-X Generator (UN/CEFACT CII syntax)
 * Used by France (Factur-X), Germany (ZUGFeRD), and other EU countries
 * Profile: COMFORT (1.0), EXTENDED (2.0), BASIC (1.0)
 */
@Injectable()
export class FacturXGenerator extends BaseFormatGenerator {
  readonly name = 'Factur-X';
  readonly supportedFormats = ['facturx', 'zugferd', 'cii', 'xrechnung'];

  supports(format: string): boolean {
    return this.supportedFormats.includes(format);
  }

  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    const profile = config.profile || 'basic';
    const xml = this.generateCIIInvoice(invoice, profile);

    return {
      xml: this.wrapWithDeclaration(xml),
      format: 'facturx',
      mimeType: 'application/xml',
    };
  }

  /**
   * Generate CII (Cross Industry Invoice) XML
   */
  private generateCIIInvoice(invoice: InvoiceData, profile: string): string {
    const sellerCountry = this.getCountryCode(invoice.supplier.country || 'france');
    const buyerCountry = this.getCountryCode(invoice.customer.country || 'france');
    const currencyCode = invoice.currency || 'EUR';

    return `<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
                                     xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
                                     xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${this.getProfileId(profile)}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${this.escapeXml(invoice.reference || invoice.rawNumber || '')}</ram:BuyerReference>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableSupplyChainTradeAgreement>
      <ram:BuyerOrderReferencedDocument>
        <ram:IssuerAssignedID>${this.escapeXml(invoice.reference || '')}</ram:IssuerAssignedID>
      </ram:BuyerOrderReferencedDocument>
    </ram:ApplicableSupplyChainTradeAgreement>
    <ram:ApplicableTradeDeliveryTerms>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>${this.formatDateTime(invoice.issueDate || new Date())}</ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableTradeDeliveryTerms>
    <ram:SellerTradeParty>
      <ram:ID>${sellerCountry}-${invoice.supplier.identifiers?.vat || invoice.supplier.identifiers?.siret || ''}</ram:ID>
      <ram:Name>${this.escapeXml(invoice.supplier.name || '')}</ram:Name>
      <ram:SpecifiedLegalOrganization>
        <ram:ID>${this.escapeXml(invoice.supplier.identifiers?.vat || invoice.supplier.identifiers?.siret || '')}</ram:ID>
      </ram:SpecifiedLegalOrganization>
      ${this.buildAddress('SellerTradeParty', invoice.supplier)}
      ${this.buildContact('SellerTradeParty', invoice.supplier)}
      <ram:URIUniversalCommunication>${this.escapeXml(invoice.supplier.website || '')}</ram:URIUniversalCommunication>
    </ram:SellerTradeParty>
    <ram:BuyerTradeParty>
      <ram:ID>${buyerCountry}-${invoice.customer.identifiers?.vat || ''}</ram:ID>
      <ram:Name>${this.escapeXml(invoice.customer.name || '')}</ram:Name>
      ${this.buildAddress('BuyerTradeParty', invoice.customer)}
      ${this.buildContact('BuyerTradeParty', invoice.customer)}
    </ram:BuyerTradeParty>
  </rsm:SupplyChainTradeTransaction>
  <rsm:ApplicableSupplyChainTradeSettlement>
    <ram:PaymentReference>${this.escapeXml(invoice.paymentReference || '')}</ram:PaymentReference>
    <ram:InvoiceReferencedDocument>
      <ram:IssuerAssignedID>${this.escapeXml(invoice.rawNumber || invoice.number || '')}</ram:IssuerAssignedID>
    </ram:InvoiceReferencedDocument>
  </rsm:ApplicableSupplyChainTradeSettlement>
  <ram:ApplicableHeaderTradeSettlement>
    <ram:InvoiceCurrencyCode>${currencyCode}</ram:InvoiceCurrencyCode>
    <ram:ApplicableTradeCurrencyExchange>
      <ram:SourceCurrencyCode>${currencyCode}</ram:SourceCurrencyCode>
      <ram:TargetCurrencyCode>${currencyCode}</ram:TargetCurrencyCode>
      <ram:ConversionRateNumeric>1.0</ram:ConversionRateNumeric>
    </ram:ApplicableTradeCurrencyExchange>
    <ram:ApplicableVATTradeCurrencyExchange>
      <ram:ApplicableVATRate>
        <ram:RateApplicablePercent>${this.getDefaultVATRate(invoice.vatBreakdown || [])}</ram:RateApplicablePercent>
      </ram:ApplicableVATRate>
    </ram:ApplicableVATTradeCurrencyExchange>
  </rsm:ApplicableHeaderTradeSettlement>
  <ram:SupplyChainTradeLineItem index="1">
    <ram:AssociatedDocumentLineDocument>
      <ram:LineID>1</ram:LineID>
      <ram:LineStatusCode>1</ram:LineStatusCode>
    </ram:AssociatedDocumentLineDocument>
    ${this.buildTradeLineItems(invoice.items, currencyCode)}
  </ram:SupplyChainTradeLineItem>
  <ram:ApplicableHeaderTradeAgreement>
    <ram:IncludedSupplyChainTradeLine/>
  </ram:ApplicableHeaderTradeAgreement>
  <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    <ram:LineTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(invoice.totals?.subtotal || 0)}</ram:LineTotalAmount>
    <ram:ChargeTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(invoice.totals?.vat || 0)}</ram:ChargeTotalAmount>
    <ram:TaxBasisTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(invoice.totals?.subtotal || 0)}</ram:TaxBasisTotalAmount>
    <ram:TaxTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}" currencyIDList="${currencyCode}">${this.formatAmount(invoice.totals?.vat || 0)}</ram:TaxTotalAmount>
    <ram:GrandTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(invoice.totals?.total || 0)}</ram:GrandTotalAmount>
    <ram:DuePayableAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(invoice.totals?.total || 0)}</ram:DuePayableAmount>
  </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</rsm:CrossIndustryInvoice>`;
  }

  /**
   * Get CII profile ID
   */
  private getProfileId(profile: string): string {
    const profiles: Record<string, string> = {
      basic: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.europa.eu:1p0:basic',
      en16931: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.europa.eu:1p0:en16931',
      comfort: 'urn:factur-x.europa.eu:1p0:comfort',
      extended: 'urn:factur-x.europa.eu:1p0:extended',
    };
    return profiles[profile] || profiles.basic;
  }

  /**
   * Build address block
   */
  private buildAddress(prefix: string, party: any): string {
    const country = this.getCountryCode(party.country);
    return `
    <${prefix}PostalTradeAddress>
      <ram:PostcodeCode>${this.escapeXml(party.postalCode || '')}</ram:PostcodeCode>
      <ram:LineOne>${this.escapeXml(party.address || '')}</ram:LineOne>
      <ram:CityName>${this.escapeXml(party.city || '')}</ram:CityName>
      <ram:CountryID>${country}</ram:CountryID>
    </${prefix}PostalTradeAddress>`;
  }

  /**
   * Build contact block
   */
  private buildContact(prefix: string, party: any): string {
    if (!party.email && !party.phone) return '';
    return `
    <${prefix}Contact>
      ${party.email ? `<ram:EmailURIUniversalCommunication>${this.escapeXml(party.email)}</ram:EmailURIUniversalCommunication>` : ''}
      ${party.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${this.escapeXml(party.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}
    </${prefix}Contact>`;
  }

  /**
   * Build trade line items
   */
  private buildTradeLineItems(items: any[], currencyCode: string): string {
    return items.map((item, index) => `
    <ram:IncludedSupplyChainTradeLineItem index="${index + 1}">
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${index + 1}</ram:LineID>
        <ram:LineStatusCode>1</ram:LineStatusCode>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${this.escapeXml(item.description)}</ram:Name>
        <ram:Description>${this.escapeXml(item.description)}</ram:Description>
        <ram:BuyerItemIdentifier>${this.escapeXml(item.code || `${index + 1}`)}</ram:BuyerItemIdentifier>
        <ram:SellerItemIdentifier>${this.escapeXml(item.code || `${index + 1}`)}</ram:SellerItemIdentifier>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${this.getUnitCode(item.type)}">${this.formatQuantity(item.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:CalculatedRate numeric="${this.formatAmount(item.vatRate)}">${this.getVatCategoryCode(item.vatRate)}</ram:CalculatedRate>
        <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${this.getVatCategoryCode(item.vatRate)}</ram:CategoryCode>
        </ram:TypeCode>
        <ram:BasisAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(item.lineTotal)}</ram:BasisAmount>
        <ram:CalculatedAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(item.vatAmount)}</ram:CalculatedAmount>
      </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:GrossLineTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(item.total)}</ram:GrossLineTotalAmount>
        <ram:NetLineTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(item.lineTotal)}</ram:NetLineTotalAmount>
        <ram:TaxTotalAmount monetaryAgencyCurrencyIDList="${currencyCode}">${this.formatAmount(item.vatAmount)}</ram:TaxTotalAmount>
      </ram:SpecifiedTradeSettlementLineMonetarySummation>
    </ram:IncludedSupplyChainTradeLineItem>
  `).join('');
  }

  /**
   * Get default VAT rate from breakdown
   */
  private getDefaultVATRate(breakdown: any[]): number {
    if (breakdown && breakdown.length > 0) {
      return breakdown[0].rate || 20;
    }
    return 20;
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
}
