/**
 * Document Service
 * Main orchestrator for compliance-based document generation
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentData,
  DocumentMetadata,
  DocumentType,
  GenerateDocumentRequest,
  GenerateDocumentResponse,
  OutputFormat,
  PDFStyleConfig,
} from './document.types';
import { getBuilder } from './builders';
import { getRenderer, getMimeType, getFileExtension } from './renderers';
import { CountryConfig } from '../interfaces';
import { getCountryConfig } from '../configs';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  /**
   * Generate a document based on type, data, and country compliance rules
   */
  async generate(request: GenerateDocumentRequest): Promise<GenerateDocumentResponse> {
    const {
      type,
      data,
      format,
      supplierCountry,
      pdfConfig,
    } = request;

    this.logger.log(`Generating ${type} document in ${format} format for ${supplierCountry}`);

    // Get country configuration
    const countryConfig = this.getCountryConfig(supplierCountry);

    // Validate format is supported for this document type
    this.validateFormat(type, format, countryConfig);

    // Get the appropriate builder
    const builderType = countryConfig.documents.builder;
    const builder = getBuilder(builderType);

    if (!builder.supportsFormat(format)) {
      this.logger.warn(
        `Builder ${builderType} doesn't support ${format}, falling back to pdf`,
      );
    }

    // Build the document (HTML + optional XML)
    const buildResult = await builder.build({
      ...request,
      pdfConfig: pdfConfig || this.getDefaultPdfConfig(),
    });

    // Get the appropriate renderer
    const renderer = getRenderer(format);

    // Render to final format
    const buffer = await renderer.render(buildResult.html, format, {
      xml: buildResult.xml,
      xmlSyntax: buildResult.metadata.xmlSyntax,
      embedXml: buildResult.metadata.requiresXmlEmbed,
      pdfACompliant: this.requiresPdfA(format),
    });

    // Build metadata
    const metadata: DocumentMetadata = {
      generatedAt: new Date(),
      builder: builderType,
      format,
      xmlEmbedded: buildResult.metadata.requiresXmlEmbed && !!buildResult.xml,
    };

    // Generate filename
    const filename = this.generateFilename(type, data.number, format);

    return {
      buffer,
      format,
      mimeType: getMimeType(format),
      filename,
      metadata,
    };
  }

  /**
   * Generate document with simplified interface
   */
  async generateDocument(
    type: DocumentType,
    data: DocumentData,
    supplierCountry: string,
    format?: OutputFormat,
    pdfConfig?: PDFStyleConfig,
  ): Promise<Buffer> {
    const countryConfig = this.getCountryConfig(supplierCountry);
    const outputFormat = format || countryConfig.documents.defaultFormat;

    const result = await this.generate({
      type,
      data,
      format: outputFormat,
      supplierCountry,
      pdfConfig,
    });

    return result.buffer;
  }

  /**
   * Get supported formats for a document type in a country
   */
  getSupportedFormats(
    type: DocumentType,
    supplierCountry: string,
  ): OutputFormat[] {
    const countryConfig = this.getCountryConfig(supplierCountry);
    const docConfig = countryConfig.documents;

    switch (type) {
      case 'invoice':
      case 'corrective-invoice':
      case 'deposit-invoice':
        return docConfig.outputFormats.invoice;
      case 'quote':
      case 'proforma':
        return docConfig.outputFormats.quote;
      case 'receipt':
        return docConfig.outputFormats.receipt;
      case 'credit-note':
        return docConfig.outputFormats['credit-note'];
      default:
        return ['pdf'];
    }
  }

  /**
   * Get default format for a country
   */
  getDefaultFormat(supplierCountry: string): OutputFormat {
    const countryConfig = this.getCountryConfig(supplierCountry);
    return countryConfig.documents.defaultFormat;
  }

  /**
   * Check if a country allows modifying invoices
   */
  canModifyInvoice(supplierCountry: string): boolean {
    const countryConfig = this.getCountryConfig(supplierCountry);
    return countryConfig.documents.modification.invoiceEditable;
  }

  /**
   * Check if credit note is required for corrections
   */
  requiresCreditNote(supplierCountry: string): boolean {
    const countryConfig = this.getCountryConfig(supplierCountry);
    return countryConfig.documents.modification.requiresCreditNote;
  }

  /**
   * Get country configuration with fallback
   */
  private getCountryConfig(countryCode: string): CountryConfig {
    try {
      return getCountryConfig(countryCode);
    } catch {
      this.logger.warn(
        `Country config not found for ${countryCode}, using GENERIC`,
      );
      return getCountryConfig('GENERIC');
    }
  }

  /**
   * Validate that the requested format is supported
   */
  private validateFormat(
    type: DocumentType,
    format: OutputFormat,
    countryConfig: CountryConfig,
  ): void {
    const supportedFormats = this.getSupportedFormatsFromConfig(type, countryConfig);

    if (!supportedFormats.includes(format)) {
      this.logger.warn(
        `Format ${format} not officially supported for ${type} in ${countryConfig.code}, ` +
        `using anyway. Supported: ${supportedFormats.join(', ')}`,
      );
    }
  }

  /**
   * Get supported formats from config
   */
  private getSupportedFormatsFromConfig(
    type: DocumentType,
    config: CountryConfig,
  ): OutputFormat[] {
    const docConfig = config.documents;

    switch (type) {
      case 'invoice':
      case 'corrective-invoice':
      case 'deposit-invoice':
        return docConfig.outputFormats.invoice;
      case 'quote':
      case 'proforma':
        return docConfig.outputFormats.quote || ['pdf'];
      case 'receipt':
        return docConfig.outputFormats.receipt;
      case 'credit-note':
        return docConfig.outputFormats['credit-note'];
      default:
        return ['pdf'];
    }
  }

  /**
   * Check if format requires PDF/A compliance
   */
  private requiresPdfA(format: OutputFormat): boolean {
    return ['facturx', 'zugferd', 'xrechnung'].includes(format);
  }

  /**
   * Generate filename for document
   */
  private generateFilename(
    type: DocumentType,
    number: string,
    format: OutputFormat,
  ): string {
    const prefix = this.getFilenamePrefix(type);
    const extension = getFileExtension(format);
    const sanitizedNumber = number.replace(/[^a-zA-Z0-9-_]/g, '_');

    return `${prefix}_${sanitizedNumber}.${extension}`;
  }

  /**
   * Get filename prefix for document type
   */
  private getFilenamePrefix(type: DocumentType): string {
    const prefixes: Record<DocumentType, string> = {
      invoice: 'INVOICE',
      quote: 'QUOTE',
      receipt: 'RECEIPT',
      'credit-note': 'CREDIT_NOTE',
      proforma: 'PROFORMA',
      'corrective-invoice': 'CORRECTIVE',
      'deposit-invoice': 'DEPOSIT',
    };
    return prefixes[type] || 'DOCUMENT';
  }

  /**
   * Get default PDF configuration
   */
  private getDefaultPdfConfig(): PDFStyleConfig {
    return {
      fontFamily: 'Arial',
      padding: 40,
      primaryColor: '#2563eb',
      secondaryColor: '#64748b',
      includeLogo: false,
      labels: {
        invoice: 'Invoice',
        quote: 'Quote',
        receipt: 'Receipt',
        creditNote: 'Credit Note',
        proforma: 'Proforma Invoice',
        date: 'Date:',
        dueDate: 'Due date:',
        validUntil: 'Valid until:',
        paymentDate: 'Payment date:',
        billTo: 'Bill to:',
        quoteFor: 'Quote for:',
        receivedFrom: 'Received from:',
        description: 'Description',
        quantity: 'Qty',
        unitPrice: 'Unit price',
        vatRate: 'VAT (%)',
        total: 'Total',
        subtotal: 'Subtotal:',
        vat: 'VAT:',
        grandTotal: 'Grand total:',
        notes: 'Notes:',
        paymentMethod: 'Payment method:',
        paymentDetails: 'Payment details:',
        hour: 'Hour',
        day: 'Day',
        service: 'Service',
        product: 'Product',
        deposit: 'Deposit',
        paymentMethodBankTransfer: 'Bank transfer',
        paymentMethodPayPal: 'PayPal',
        paymentMethodCash: 'Cash',
        paymentMethodCheck: 'Check',
        paymentMethodOther: 'Other',
        originalInvoice: 'Original invoice:',
        correctionReason: 'Reason:',
      },
    };
  }
}
