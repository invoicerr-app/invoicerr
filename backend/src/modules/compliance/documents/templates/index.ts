/**
 * Document Templates Index
 */

export * from './base.template';
export { creditNoteTemplate } from './credit-note.template';
export { invoiceTemplate } from './invoice.template';
export { quoteTemplate } from './quote.template';
export { receiptTemplate } from './receipt.template';

import { DocumentType } from '../document.types';
import { creditNoteTemplate } from './credit-note.template';
import { invoiceTemplate } from './invoice.template';
import { quoteTemplate } from './quote.template';
import { receiptTemplate } from './receipt.template';

/**
 * Get template for document type
 */
export function getTemplate(type: DocumentType): string {
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
