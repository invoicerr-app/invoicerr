/**
 * Document Types for Compliance-based PDF Generation
 */

// ============================================================================
// Document Type Enum
// ============================================================================

export type DocumentType =
  | 'invoice'
  | 'quote'
  | 'receipt'
  | 'credit-note'
  | 'proforma'
  | 'corrective-invoice'
  | 'deposit-invoice';

// ============================================================================
// Output Formats
// ============================================================================

export type OutputFormat =
  | 'pdf'           // Simple PDF
  | 'facturx'       // Factur-X (PDF/A-3 + XML)
  | 'zugferd'       // ZUGFeRD (German Factur-X)
  | 'xrechnung'     // XRechnung (German B2G)
  | 'ubl'           // UBL 2.1 XML
  | 'cii'           // UN/CEFACT CII XML
  | 'fatturapa';    // FatturaPA (Italy)

// ============================================================================
// Builder Types
// ============================================================================

export type BuilderType = 'generic' | 'eu' | 'it' | 'es' | 'pt';

// ============================================================================
// Common Entity Interfaces
// ============================================================================

export interface DocumentParty {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  countryCode?: string;
  email?: string;
  phone?: string;
  identifiers?: Record<string, string>;
}

export interface DocumentItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatAmount?: number;
  lineTotal?: number;
  totalHT?: number;
  totalTTC?: number;
  type?: string;
  itemType?: 'goods' | 'services';
}

export interface DocumentTotals {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  vatBreakdown?: VATBreakdownItem[];
}

export interface VATBreakdownItem {
  rate: number;
  baseAmount: number;
  vatAmount: number;
}

// ============================================================================
// Document Data Interfaces
// ============================================================================

export interface BaseDocumentData {
  id: string;
  number: string;
  rawNumber?: string;
  createdAt: Date;
  currency: string;
  supplier: DocumentParty;
  customer: DocumentParty;
  items: DocumentItem[];
  totals: DocumentTotals;
  notes?: string;
  paymentMethod?: {
    type: string;
    details?: string;
  };
  legalMentions?: string[];
}

export interface InvoiceDocumentData extends BaseDocumentData {
  type: 'invoice';
  dueDate: Date;
  paymentTerms?: string;
  purchaseOrderRef?: string;
}

export interface QuoteDocumentData extends BaseDocumentData {
  type: 'quote';
  validUntil: Date;
  signedAt?: Date;
}

export interface ReceiptDocumentData extends BaseDocumentData {
  type: 'receipt';
  paymentDate: Date;
  invoiceRef?: string;
  invoiceNumber?: string;
}

export interface CreditNoteDocumentData extends BaseDocumentData {
  type: 'credit-note';
  originalInvoiceRef: string;
  originalInvoiceNumber: string;
  correctionCode?: string;
  correctionReason?: string;
}

export interface ProformaDocumentData extends BaseDocumentData {
  type: 'proforma';
  validUntil: Date;
}

export type DocumentData =
  | InvoiceDocumentData
  | QuoteDocumentData
  | ReceiptDocumentData
  | CreditNoteDocumentData
  | ProformaDocumentData;

// ============================================================================
// Generation Request/Response
// ============================================================================

export interface GenerateDocumentRequest {
  type: DocumentType;
  data: DocumentData;
  format: OutputFormat;
  supplierCountry: string;
  locale?: string;
  pdfConfig?: PDFStyleConfig;
}

export interface GenerateDocumentResponse {
  buffer: Buffer;
  format: OutputFormat;
  mimeType: string;
  filename: string;
  metadata?: DocumentMetadata;
}

export interface DocumentMetadata {
  generatedAt: Date;
  builder: BuilderType;
  format: OutputFormat;
  xmlEmbedded?: boolean;
  validationPassed?: boolean;
  warnings?: string[];
}

// ============================================================================
// PDF Style Configuration
// ============================================================================

export interface PDFStyleConfig {
  fontFamily: string;
  padding: number;
  primaryColor: string;
  secondaryColor: string;
  includeLogo: boolean;
  logoB64?: string;
  labels: PDFLabels;
}

export interface PDFLabels {
  // Document titles
  invoice: string;
  quote: string;
  receipt: string;
  creditNote: string;
  proforma: string;

  // Common labels
  date: string;
  dueDate: string;
  validUntil: string;
  paymentDate: string;
  billTo: string;
  quoteFor: string;
  receivedFrom: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  total: string;
  subtotal: string;
  vat: string;
  grandTotal: string;
  notes: string;
  paymentMethod: string;
  paymentDetails: string;

  // Item types
  hour: string;
  day: string;
  service: string;
  product: string;
  deposit: string;

  // Payment methods
  paymentMethodBankTransfer: string;
  paymentMethodPayPal: string;
  paymentMethodCash: string;
  paymentMethodCheck: string;
  paymentMethodOther: string;

  // Credit note specific
  originalInvoice: string;
  correctionReason: string;
}

// ============================================================================
// Template Context (passed to Handlebars)
// ============================================================================

export interface TemplateContext {
  // Document info
  number: string;
  date: string;
  dueDate?: string;
  validUntil?: string;
  paymentDate?: string;

  // Parties
  company: DocumentParty & { description?: string };
  client: DocumentParty & { description?: string };

  // Items
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    vatRate: number;
    totalPrice: string;
    type: string;
  }>;

  // Totals
  totalHT: string;
  totalVAT: string;
  totalTTC: string;
  vatBreakdown?: Array<{
    rate: number;
    baseAmount: string;
    vatAmount: string;
  }>;

  // Currency
  currency: string;
  currencySymbol: string;

  // Payment
  paymentMethod?: string;
  paymentDetails?: string;

  // Legal
  vatExemptText?: string;
  legalMentions?: string[];
  notes?: string;

  // Credit note specific
  originalInvoiceRef?: string;
  originalInvoiceNumber?: string;
  correctionReason?: string;

  // Style
  fontFamily: string;
  padding: number;
  primaryColor: string;
  secondaryColor: string;
  tableTextColor: string;
  includeLogo: boolean;
  logoB64: string;

  // Labels
  labels: PDFLabels;

  // QR Code (if required by country)
  qrCode?: string;
}

// ============================================================================
// Builder Interface
// ============================================================================

export interface IDocumentBuilder {
  readonly type: BuilderType;
  readonly supportedFormats: OutputFormat[];
  readonly supportedDocuments: DocumentType[];

  build(request: GenerateDocumentRequest): Promise<BuildResult>;

  supportsFormat(format: OutputFormat): boolean;
  supportsDocument(type: DocumentType): boolean;
}

export interface BuildResult {
  html: string;
  xml?: string;
  metadata: {
    requiresXmlEmbed: boolean;
    xmlSyntax?: 'ubl' | 'cii' | 'fatturapa';
  };
}

// ============================================================================
// Renderer Interface
// ============================================================================

export interface IDocumentRenderer {
  render(
    html: string,
    format: OutputFormat,
    options?: RenderOptions,
  ): Promise<Buffer>;
}

export interface RenderOptions {
  xml?: string;
  xmlSyntax?: 'ubl' | 'cii' | 'fatturapa';
  embedXml?: boolean;
  pdfACompliant?: boolean;
}

// ============================================================================
// Validator Interface
// ============================================================================

export interface IDocumentValidator {
  validate(
    document: DocumentData,
    countryCode: string,
  ): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
}
