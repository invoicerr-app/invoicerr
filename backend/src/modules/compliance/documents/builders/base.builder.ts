/**
 * Base Document Builder
 * Abstract class that all document builders extend
 */

import * as Handlebars from 'handlebars';
import { CountryConfig } from '../../interfaces';
import {
  BuilderType,
  BuildResult,
  DocumentData,
  DocumentType,
  GenerateDocumentRequest,
  IDocumentBuilder,
  OutputFormat,
  PDFLabels,
  PDFStyleConfig,
  TemplateContext,
} from '../document.types';

/**
 * Abstract base builder with common functionality
 */
export abstract class BaseDocumentBuilder implements IDocumentBuilder {
  abstract readonly type: BuilderType;
  abstract readonly supportedFormats: OutputFormat[];
  abstract readonly supportedDocuments: DocumentType[];

  /**
   * Build the document
   */
  abstract build(request: GenerateDocumentRequest): Promise<BuildResult>;

  /**
   * Check if this builder supports the given format
   */
  supportsFormat(format: OutputFormat): boolean {
    return this.supportedFormats.includes(format);
  }

  /**
   * Check if this builder supports the given document type
   */
  supportsDocument(type: DocumentType): boolean {
    return this.supportedDocuments.includes(type);
  }

  /**
   * Build template context from document data
   */
  protected buildTemplateContext(
    data: DocumentData,
    pdfConfig: PDFStyleConfig,
    _countryConfig?: CountryConfig,
  ): TemplateContext {
    const currencySymbol = this.getCurrencySymbol(data.currency);

    const context: TemplateContext = {
      // Document info
      number: data.rawNumber || data.number,
      date: this.formatDate(data.createdAt),

      // Parties
      company: {
        ...data.supplier,
        description: undefined,
      },
      client: {
        ...data.customer,
        description: undefined,
      },

      // Items
      items: data.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: this.formatMoney(item.unitPrice, data.currency),
        vatRate: item.vatRate,
        totalPrice: this.formatMoney(
          item.totalTTC ??
            item.lineTotal ??
            item.quantity * item.unitPrice * (1 + item.vatRate / 100),
          data.currency,
        ),
        type: this.getItemTypeLabel(item.type || item.itemType || 'service', pdfConfig.labels),
      })),

      // Totals
      totalHT: this.formatMoney(data.totals.totalHT, data.currency),
      totalVAT: this.formatMoney(data.totals.totalVAT, data.currency),
      totalTTC: this.formatMoney(data.totals.totalTTC, data.currency),
      vatBreakdown: data.totals.vatBreakdown?.map((vb) => ({
        rate: vb.rate,
        baseAmount: this.formatMoney(vb.baseAmount, data.currency),
        vatAmount: this.formatMoney(vb.vatAmount, data.currency),
      })),

      // Currency
      currency: data.currency,
      currencySymbol,

      // Payment
      paymentMethod: data.paymentMethod?.type
        ? this.getPaymentMethodLabel(data.paymentMethod.type, pdfConfig.labels)
        : undefined,
      paymentDetails: data.paymentMethod?.details,

      // Notes
      notes: data.notes,

      // Legal
      legalMentions: data.legalMentions,

      // Style
      fontFamily: pdfConfig.fontFamily,
      padding: pdfConfig.padding,
      primaryColor: pdfConfig.primaryColor,
      secondaryColor: pdfConfig.secondaryColor,
      tableTextColor: this.getContrastColor(pdfConfig.secondaryColor),
      includeLogo: pdfConfig.includeLogo,
      logoB64: pdfConfig.logoB64 || '',

      // Labels
      labels: pdfConfig.labels,
    };

    // Add type-specific fields
    this.addTypeSpecificFields(context, data);

    return context;
  }

  /**
   * Add type-specific fields to context
   */
  protected addTypeSpecificFields(context: TemplateContext, data: DocumentData): void {
    switch (data.type) {
      case 'invoice':
        context.dueDate = this.formatDate(data.dueDate);
        break;
      case 'quote':
        context.validUntil = this.formatDate(data.validUntil);
        break;
      case 'receipt':
        context.paymentDate = this.formatDate(data.paymentDate);
        context.originalInvoiceRef = data.invoiceRef;
        context.originalInvoiceNumber = data.invoiceNumber;
        break;
      case 'credit-note':
        context.originalInvoiceRef = data.originalInvoiceRef;
        context.originalInvoiceNumber = data.originalInvoiceNumber;
        context.correctionReason = data.correctionReason;
        break;
    }
  }

  /**
   * Compile Handlebars template
   */
  protected compileTemplate(templateString: string): HandlebarsTemplateDelegate {
    return Handlebars.compile(templateString);
  }

  /**
   * Format date for display
   */
  protected formatDate(date: Date, locale = 'fr-FR'): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  /**
   * Format money amount
   */
  protected formatMoney(amount: number, _currency: string): string {
    return new Intl.NumberFormat('fr-FR', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  /**
   * Get currency symbol
   */
  protected getCurrencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      EUR: '€',
      USD: '$',
      GBP: '£',
      CHF: 'CHF',
      JPY: '¥',
      CNY: '¥',
    };
    return symbols[currency] || currency;
  }

  /**
   * Get contrasting text color for background
   */
  protected getContrastColor(hexColor: string): string {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  /**
   * Get item type label
   */
  protected getItemTypeLabel(type: string, labels: PDFLabels): string {
    const typeMap: Record<string, keyof PDFLabels> = {
      HOUR: 'hour',
      DAY: 'day',
      SERVICE: 'service',
      PRODUCT: 'product',
      DEPOSIT: 'deposit',
    };
    const labelKey = typeMap[type];
    return labelKey ? labels[labelKey] : type;
  }

  /**
   * Get payment method label
   */
  protected getPaymentMethodLabel(type: string, labels: PDFLabels): string {
    const typeMap: Record<string, keyof PDFLabels> = {
      BANK_TRANSFER: 'paymentMethodBankTransfer',
      PAYPAL: 'paymentMethodPayPal',
      CASH: 'paymentMethodCash',
      CHECK: 'paymentMethodCheck',
      OTHER: 'paymentMethodOther',
    };
    const labelKey = typeMap[type];
    return labelKey ? labels[labelKey] : type;
  }

  /**
   * Escape XML special characters
   */
  protected escapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get default PDF labels
   */
  protected getDefaultLabels(): PDFLabels {
    return {
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
    };
  }
}
