/**
 * Definition of an identifier (SIRET, NIF, ABN, etc.)
 */
export interface IdentifierDefinition {
  /** Unique identifier key (e.g., 'siret', 'nif', 'abn') */
  id: string;
  /** i18n label key */
  labelKey: string;
  /** Validation regex pattern */
  format: string;
  /** Example value for the identifier */
  example?: string;
  /** Is this identifier required */
  required: boolean;
  /** Maximum length */
  maxLength?: number;
  /** Should Luhn checksum be validated */
  luhnCheck?: boolean;
  /** Peppol scheme ID (e.g., '0009' for SIRET) */
  peppolScheme?: string;
}

/**
 * Identifier configuration for a country
 */
export interface IdentifierConfig {
  /** Company (supplier) identifiers */
  company: IdentifierDefinition[];
  /** Client (customer) identifiers */
  client: IdentifierDefinition[];
}
