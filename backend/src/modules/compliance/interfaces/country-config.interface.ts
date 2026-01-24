import { ArchivingConfig } from './archiving.interface';
import { ClearanceConfig } from './clearance.interface';
import { CorrectionConfig } from './correction.interface';
import { DocumentConfig } from './document-config.interface';
import { FormatConfig } from './format.interface';
import { IdentifierConfig } from './identifier.interface';
import { NumberingConfig } from './numbering.interface';
import { PeppolConfig } from './peppol.interface';
import { QRCodeConfig, SignatureConfig } from './signature.interface';
import { TransmissionConfig } from './transmission.interface';
import { VATConfig, VATExemption, VATRate } from './vat.interface';

// Re-export for backwards compatibility
export { VATRate, VATExemption };

/**
 * Identifier definition (re-exported for backwards compatibility)
 */
export interface CountryIdentifier {
  id: string;
  labelKey: string;
  format: string;
  required: boolean;
}

/**
 * Condition for conditional legal mentions
 */
export type MentionCondition =
  | { type: 'field'; field: string; value: unknown }
  | { type: 'transaction'; property: 'isIntraEU' | 'isExport' | 'isDomestic' }
  | { type: 'customer'; property: 'isVatRegistered' | 'isPublicEntity' }
  | { type: 'supplier'; property: 'exemptVat' | 'isVatRegistered' }
  | { type: 'expression'; expression: string };

/**
 * Conditional legal mention
 */
export interface ConditionalMention {
  /** Condition string (legacy) or structured condition */
  condition: string | MentionCondition;
  /** i18n text key */
  textKey: string;
}

/**
 * Custom field definition for country-specific fields
 */
export interface CustomFieldDefinition {
  /** Field identifier */
  id: string;
  /** i18n label key */
  labelKey: string;
  /** Field type */
  type: 'string' | 'number' | 'date' | 'select' | 'boolean';
  /** Is field required */
  required: boolean;
  /** Validation format (regex) */
  format?: string;
  /** Options for select type */
  options?: Array<{ value: string; labelKey: string }>;
  /** Maps to a standard field */
  mappedTo?: string;
}

/**
 * Payment reference configuration (e.g., Swiss QR-Bill, Belgian structured reference)
 */
export interface PaymentReferenceConfig {
  /** System name (e.g., 'qr-bill', 'ogm-vcs') */
  system: string;
  /** Reference format (regex) */
  format: string;
  /** Reference generator function name */
  generator?: string;
  /** i18n label key */
  labelKey: string;
}

/**
 * Complete country configuration
 */
export interface CountryConfig {
  /** ISO 3166-1 alpha-2 country code */
  code: string;
  /** Country name (i18n key) */
  name?: string;
  /** Default currency (ISO 4217) */
  currency: string;
  /** Default locale */
  locale?: string;
  /** Timezone */
  timezone?: string;
  /** Is EU member state */
  isEU: boolean;
  /** EU membership date (for historical checks) */
  euSince?: string;

  /** VAT configuration */
  vat: VATConfig;

  /** Identifier configuration */
  identifiers: IdentifierConfig;

  /** Transmission configuration */
  transmission: {
    b2b: TransmissionConfig;
    b2g: TransmissionConfig;
    b2c?: TransmissionConfig;
  };

  /** Invoice numbering configuration */
  numbering: NumberingConfig;

  /** Document format configuration */
  format: FormatConfig;

  /** Digital signature configuration */
  signature?: SignatureConfig;

  /** QR code configuration */
  qrCode?: QRCodeConfig;

  /** Invoice correction configuration */
  correction?: CorrectionConfig;

  /** Document archiving configuration */
  archiving?: ArchivingConfig;

  /** Clearance model configuration (if applicable) */
  clearance?: ClearanceConfig;

  /** Peppol configuration */
  peppol?: PeppolConfig;

  /** Required fields by document type */
  requiredFields: {
    invoice: string[];
    client: string[];
    quote?: string[];
  };

  /** Legal mentions */
  legalMentions: {
    /** Always required mentions (i18n keys) */
    mandatory: string[];
    /** Conditionally required mentions */
    conditional: ConditionalMention[];
  };

  /** Country-specific custom fields */
  customFields?: CustomFieldDefinition[];

  /** Payment reference configuration */
  paymentReference?: PaymentReferenceConfig;

  /** Document generation configuration */
  documents: DocumentConfig;
}
