/**
 * Document XML syntax
 */
export type DocumentSyntax =
  | 'UBL' // Universal Business Language
  | 'CII' // Cross-Industry Invoice (UN/CEFACT)
  | 'FatturaPA' // Italian format
  | 'Facturae' // Spanish format
  | 'FA3' // Polish KSeF format
  | 'NAV' // Hungarian NAV format
  | 'myDATA' // Greek format
  | 'GST_JSON' // Indian GST JSON format
  | 'GB_T_38636'; // Chinese format

/**
 * E-invoice format configuration
 */
export interface FormatConfig {
  /** Preferred format */
  preferred: string;
  /** Supported formats */
  supported: string[];
  /** XML syntax */
  syntax: DocumentSyntax;
  /** Format version */
  version?: string;
  /** CIUS profile name (e.g., 'XRechnung', 'Factur-X') */
  profile?: string;
  /** Peppol CustomizationID */
  customizationId?: string;
  /** Peppol ProfileID */
  profileId?: string;
}
