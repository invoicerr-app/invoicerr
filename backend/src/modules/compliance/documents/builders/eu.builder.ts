/**
 * EU Document Builder
 * Supports PDF + XML formats (Factur-X, ZUGFeRD, UBL, CII)
 */

import { Injectable } from '@nestjs/common';
import {
  BuilderType,
  BuildResult,
  DocumentType,
  GenerateDocumentRequest,
  OutputFormat,
} from '../document.types';
import { creditNoteTemplate, invoiceTemplate, quoteTemplate, receiptTemplate } from '../templates';
import { BaseDocumentBuilder } from './base.builder';

/**
 * EU document builder with e-invoicing support
 */
@Injectable()
export class EUDocumentBuilder extends BaseDocumentBuilder {
  readonly type: BuilderType = 'eu';
  readonly supportedFormats: OutputFormat[] = [
    'pdf',
    'facturx',
    'zugferd',
    'xrechnung',
    'ubl',
    'cii',
  ];
  readonly supportedDocuments: DocumentType[] = [
    'invoice',
    'quote',
    'receipt',
    'credit-note',
  ];

  async build(request: GenerateDocumentRequest): Promise<BuildResult> {
    const { type, data, format, pdfConfig } = request;

    // Get appropriate template
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

    // Compile and render HTML
    const template = this.compileTemplate(templateString);
    const html = template(context);

    // Generate XML if needed
    let xml: string | undefined;
    let xmlSyntax: 'ubl' | 'cii' | 'fatturapa' | undefined;

    if (['facturx', 'zugferd', 'cii', 'xrechnung', 'ubl'].includes(format)) {
      const xmlResult = await this.generateXML(data, format);
      xml = xmlResult.xml;
      xmlSyntax = xmlResult.syntax;
    }

    return {
      html,
      xml,
      metadata: {
        requiresXmlEmbed: !!xml,
        xmlSyntax,
      },
    };
  }

  /**
   * Generate XML for invoice
   */
  private async generateXML(
    data: any,
    format: OutputFormat,
  ): Promise<{ xml: string; syntax: 'ubl' | 'cii' }> {
    // This would delegate to FormatService
    // For now, return a placeholder
    if (['facturx', 'zugferd', 'cii'].includes(format)) {
      return {
        xml: this.generateCIIPlaceholder(data),
        syntax: 'cii',
      };
    }

    return {
      xml: this.generateUBLPlaceholder(data),
      syntax: 'ubl',
    };
  }

  /**
   * Generate CII XML placeholder (Factur-X/ZUGFeRD)
   */
  private generateCIIPlaceholder(data: any): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
                          xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
                          xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.europa.eu:1p0:1.0</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${this.escapeXml(data.supplier?.name || '')}</ram:Name>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${this.escapeXml(data.customer?.name || '')}</ram:Name>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
  }

  /**
   * Generate UBL XML placeholder
   */
  private generateUBLPlaceholder(data: any): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
          xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
          xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
          xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ID>${this.escapeXml(data.rawNumber || data.number || '')}</cbc:ID>
  <cbc:IssueDate>${this.formatDate(data.createdAt)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(data.supplier?.name || '')}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(data.customer?.name || '')}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
</Invoice>`;
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
}
