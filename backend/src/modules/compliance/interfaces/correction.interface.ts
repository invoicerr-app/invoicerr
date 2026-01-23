/**
 * Invoice correction method
 */
export type CorrectionMethod =
  | 'credit_note' // Issue a credit note
  | 'corrective_invoice' // Issue a corrective invoice
  | 'replacement' // Cancel and replace
  | 'void_and_reissue' // Void original, issue new
  | 'platform_request'; // Request correction via platform (China)

/**
 * Invoice correction configuration
 */
export interface CorrectionConfig {
  /** Can invoices be modified directly after issuance */
  allowDirectModification: boolean;
  /** Primary correction method */
  method: CorrectionMethod;
  /** Must reference original invoice */
  requiresOriginalReference: boolean;
  /** Available correction/credit note type codes */
  codes?: Array<{
    code: string;
    labelKey: string;
    /** UBL InvoiceTypeCode for credit notes */
    ublTypeCode?: string;
  }>;
  /** Requires pre-approval from platform (China) */
  requiresPreApproval?: boolean;
  /** Approval endpoint if required */
  approvalEndpoint?: string;
  /** i18n key for correction text to appear on document */
  correctionTextKey?: string;
}
