/**
 * Generic Document Builder
 * Simple PDF generation without e-invoicing features
 */

import {
  BuilderType,
  BuildResult,
  DocumentType,
  GenerateDocumentRequest,
  OutputFormat,
} from '../document.types';
import { BaseDocumentBuilder } from './base.builder';
import {
  invoiceTemplate,
  quoteTemplate,
  receiptTemplate,
  creditNoteTemplate,
} from '../templates';

/**
 * Generic builder for simple PDF documents
 * Used for countries without specific e-invoicing requirements
 */
export class GenericDocumentBuilder extends BaseDocumentBuilder {
  readonly type: BuilderType = 'generic';
  readonly supportedFormats: OutputFormat[] = ['pdf'];
  readonly supportedDocuments: DocumentType[] = [
    'invoice',
    'quote',
    'receipt',
    'credit-note',
    'proforma',
  ];

  async build(request: GenerateDocumentRequest): Promise<BuildResult> {
    const { type, data, pdfConfig } = request;

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

    // Compile and render HTML
    const template = this.compileTemplate(templateString);
    const html = template(context);

    return {
      html,
      metadata: {
        requiresXmlEmbed: false,
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
}
