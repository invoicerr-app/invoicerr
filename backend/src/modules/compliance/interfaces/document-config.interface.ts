/**
 * Document Configuration Interface
 * Defines how documents are generated for a specific country
 */

import { BuilderType, DocumentType, OutputFormat } from '../documents/document.types';

/**
 * Document generation configuration for a country
 */
export interface DocumentConfig {
  /**
   * Builder to use for this country
   * - 'generic': Simple PDF without e-invoicing
   * - 'eu': European standard (Factur-X, ZUGFeRD, UBL)
   * - 'it': Italy (FatturaPA)
   * - 'es': Spain (TicketBAI, SII)
   * - 'pt': Portugal (SAF-T PT)
   */
  builder: BuilderType;

  /**
   * Supported output formats per document type
   */
  outputFormats: {
    invoice: OutputFormat[];
    quote: OutputFormat[];
    receipt: OutputFormat[];
    'credit-note': OutputFormat[];
    proforma?: OutputFormat[];
  };

  /**
   * Default output format when not specified
   */
  defaultFormat: OutputFormat;

  /**
   * Document modification rules
   */
  modification: DocumentModificationRules;

  /**
   * Required elements per document type
   */
  requiredElements: {
    invoice: RequiredElement[];
    quote: RequiredElement[];
    receipt: RequiredElement[];
    'credit-note': RequiredElement[];
  };

  /**
   * Custom template overrides (optional)
   */
  customTemplates?: Partial<Record<DocumentType, string>>;

  /**
   * Archiving requirements
   */
  archiving?: ArchivingConfig;
}

/**
 * Rules for document modification
 */
export interface DocumentModificationRules {
  /**
   * Can invoices be edited after issuance?
   */
  invoiceEditable: boolean;

  /**
   * Is a credit note required to correct an invoice?
   */
  requiresCreditNote: boolean;

  /**
   * Must corrections be done via a new invoice?
   */
  requiresNewInvoice: boolean;

  /**
   * Are correction codes mandatory for credit notes?
   */
  correctionCodesRequired: boolean;

  /**
   * Allowed correction methods
   */
  allowedCorrectionMethods: CorrectionMethod[];
}

export type CorrectionMethod =
  | 'credit-note'       // Full credit note
  | 'corrective-invoice' // Corrective invoice
  | 'amendment'         // Amendment to original
  | 'cancellation';     // Cancel and re-issue

/**
 * Elements required on documents
 */
export type RequiredElement =
  | 'qrCode'
  | 'legalMentions'
  | 'vatBreakdown'
  | 'vatExemptText'
  | 'paymentTerms'
  | 'dueDate'
  | 'validityDate'
  | 'originalInvoiceRef'
  | 'correctionCode'
  | 'bankDetails'
  | 'supplierIdentifiers'
  | 'customerIdentifiers'
  | 'documentHash'
  | 'sequentialNumber'
  | 'fiscalYear';

/**
 * Archiving requirements
 */
export interface ArchivingConfig {
  /**
   * Minimum retention period in years
   */
  retentionYears: number;

  /**
   * Required format for archival
   */
  archivalFormat: 'pdf' | 'pdf-a' | 'xml';

  /**
   * Is digital signature required for archival?
   */
  signatureRequired: boolean;

  /**
   * Is hash chaining required?
   */
  hashChainRequired: boolean;
}

/**
 * Default document configuration (for generic/fallback)
 */
export const DEFAULT_DOCUMENT_CONFIG: DocumentConfig = {
  builder: 'generic',
  outputFormats: {
    invoice: ['pdf'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf'],
    proforma: ['pdf'],
  },
  defaultFormat: 'pdf',
  modification: {
    invoiceEditable: true,
    requiresCreditNote: false,
    requiresNewInvoice: false,
    correctionCodesRequired: false,
    allowedCorrectionMethods: ['credit-note', 'amendment', 'cancellation'],
  },
  requiredElements: {
    invoice: ['vatBreakdown'],
    quote: ['validityDate'],
    receipt: [],
    'credit-note': ['originalInvoiceRef'],
  },
};

/**
 * EU standard document configuration
 */
export const EU_DOCUMENT_CONFIG: DocumentConfig = {
  builder: 'eu',
  outputFormats: {
    invoice: ['pdf', 'facturx', 'zugferd', 'ubl', 'cii'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf', 'facturx', 'ubl'],
    proforma: ['pdf'],
  },
  defaultFormat: 'facturx',
  modification: {
    invoiceEditable: false,
    requiresCreditNote: true,
    requiresNewInvoice: false,
    correctionCodesRequired: false,
    allowedCorrectionMethods: ['credit-note', 'corrective-invoice'],
  },
  requiredElements: {
    invoice: ['vatBreakdown', 'legalMentions', 'dueDate', 'supplierIdentifiers'],
    quote: ['validityDate', 'legalMentions'],
    receipt: ['originalInvoiceRef'],
    'credit-note': ['originalInvoiceRef', 'vatBreakdown'],
  },
  archiving: {
    retentionYears: 10,
    archivalFormat: 'pdf-a',
    signatureRequired: false,
    hashChainRequired: false,
  },
};
