/**
 * Invoice numbering configuration
 */
export interface NumberingConfig {
  /** Are invoice series required (e.g., Spain, Portugal) */
  seriesRequired: boolean;
  /** Must series be registered with tax authority (Portugal: AT) */
  seriesRegistration: boolean;
  /** Format for series (regex) */
  seriesFormat?: string;
  /** Is hash chaining required (Spain Veri*Factu, Portugal SAF-T) */
  hashChaining: boolean;
  /** Hash algorithm for chain (e.g., 'SHA-256', 'SHA-1') */
  hashAlgorithm?: string;
  /** Fields included in hash calculation */
  hashFields?: string[];
  /** Are gaps allowed in numbering sequence */
  gapAllowed: boolean;
  /** When to reset numbering */
  resetPeriod: 'never' | 'yearly' | 'monthly';
  /** Is invoice number assigned by platform (clearance models) */
  platformAssigned?: boolean;
  /** Field name for platform-assigned ID */
  platformIdField?: string;
  /** Format for platform-assigned ID */
  platformIdFormat?: string;
}
