/**
 * Documents Module Index
 * Compliance-based document generation
 */

// Types
export * from './document.types';

// Service
export { DocumentService } from './document.service';

// Builders
export {
  BaseDocumentBuilder,
  GenericDocumentBuilder,
  getBuilder,
  isBuilderSupported,
  getSupportedBuilders,
} from './builders';

// Templates
export {
  getTemplate,
  invoiceTemplate,
  quoteTemplate,
  receiptTemplate,
  creditNoteTemplate,
} from './templates';

// Renderers
export {
  PDFRenderer,
  HybridRenderer,
  XMLRenderer,
  getRenderer,
  getMimeType,
  getFileExtension,
} from './renderers';
