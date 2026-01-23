/**
 * Peppol network configuration
 */
export interface PeppolConfig {
  /** Is Peppol enabled/supported in this country */
  enabled: boolean;
  /** Peppol scheme ID (e.g., '0009' for SIRET, '0088' for GLN) */
  schemeId: string;
  /** Participant ID format */
  participantIdFormat?: string;
  /** Document type ID */
  documentTypeId?: string;
  /** Process ID */
  processId?: string;
  /** Customization ID */
  customizationId?: string;
  /** Local standard name (e.g., 'SI-UBL', 'PINT-ANZ', 'JP-PINT') */
  localStandard?: string;
  /** Local standard version */
  localVersion?: string;
  /** Validator URL */
  validatorUrl?: string;
  /** Schematron validation rules URL */
  schematronRules?: string;
  /** Is 5-corner model used (with service provider) */
  fiveCorner?: boolean;
}
