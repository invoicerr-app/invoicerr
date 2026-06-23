/**
 * Core compliance taxonomy — see COMPLIANCE_ARCHITECTURE.md §5.
 *
 * These are deliberately open string-literal unions: a new country is expressed by
 * *assigning values* to these axes (plus, at most, a small strategy), never by editing
 * the engine. The engine consumes only these abstract values, never a country name.
 */

/** ISO 3166-1 alpha-2 country code (2-letter, upper-case). */
export type ISO3166Alpha2 = string;

export type TaxSystemKind = 'VAT' | 'GST' | 'SALES_TAX' | 'CONSUMPTION_TAX' | 'NONE';

/** EN 16931 UNCL5305 VAT category codes (subset used by the engine). */
export type TaxCategoryCode =
  | 'S' // Standard rate
  | 'Z' // Zero rated
  | 'E' // Exempt
  | 'AE' // VAT reverse charge
  | 'K' // VAT exempt — intra-Community supply of goods
  | 'G' // Free export item — VAT not charged (export of goods outside the union)
  | 'O' // Services outside scope of tax
  | 'L' // Canary Islands general indirect tax
  | 'M'; // Tax for production/services in Ceuta & Melilla

export type SupplyType = 'GOODS' | 'SERVICES' | 'DIGITAL' | 'MIXED';

export type PartyRole = 'B2B' | 'B2C' | 'B2G';

export type RegimeModel =
  | 'POST_AUDIT'
  | 'PERIODIC_REPORTING'
  | 'REAL_TIME_REPORTING'
  | 'CLEARANCE'
  | 'DECENTRALIZED_CTC';

export type DocumentSyntax =
  | 'PLAIN_PDF'
  | 'PDF_A3'
  | 'FACTURX'
  | 'ZUGFERD'
  | 'XRECHNUNG'
  | 'EN16931_UBL'
  | 'EN16931_CII'
  | 'PEPPOL_BIS'
  | 'FATTURAPA'
  | 'CFDI'
  | 'FA_VAT'
  | 'KSA_UBL'
  | 'NATIONAL_XML'; // generic placeholder for a national clearance XML without a dedicated provider yet

export type ChannelType =
  | 'EMAIL'
  | 'PEPPOL'
  | 'GOV_PORTAL_API'
  | 'PAC'
  | 'PDP'
  | 'OSE'
  | 'SDI'
  | 'PRINT';

export type ReportingKind =
  | 'EC_SALES_LIST'
  | 'INTRASTAT'
  | 'OSS'
  | 'IOSS'
  | 'SAFT'
  | 'E_REPORTING'
  | 'SALES_PURCHASE_LEDGER'
  | 'CUSTOMS_EXPORT';

export type Confidence = 'OFFICIAL' | 'BEST_EFFORT' | 'PLANNED' | 'FALLBACK' | 'UNVERIFIED';

export type TaxScheme =
  | 'STANDARD'
  | 'FRANCHISE_BASE'
  | 'FLAT_RATE'
  | 'EXEMPT'
  | 'MARGIN'
  | 'OSS'
  | 'IOSS';

export type NumberingModel = 'GAPLESS_SELF' | 'AUTHORITY_RANGE';

export type CorrectionModel = 'CREDIT_NOTE' | 'CORRECTIVE_INVOICE' | 'CANCEL_AND_REPLACE';

export type ArtifactRole = 'AUTHORITATIVE' | 'HUMAN' | 'BUYER';

export type DocumentKind =
  | 'INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'CORRECTIVE_INVOICE'
  | 'PREPAYMENT'
  | 'SELF_BILLED'
  | 'EXPORT_INVOICE'
  | 'CASH_RECEIPT'
  | 'WITHHOLDING_RECEIPT'
  | 'PAYMENT_RECEIPT';
