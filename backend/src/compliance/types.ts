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
  // --- National clearance/reporting syntaxes with a dedicated (stubbed) provider ---
  // LATAM
  | 'AR_FE' // Argentina — Factura Electrónica (WSFE/CAE), ARCA/AFIP
  | 'BO_FE' // Bolivia — Facturación Electrónica (SIN), CUF
  | 'NFE' // Brazil — NF-e / NFC-e / NFS-e / NFCom / CT-e (SEFAZ)
  | 'CL_DTE' // Chile — Documento Tributario Electrónico (SII), CAF folios
  | 'CR_FE' // Costa Rica — Factura Electrónica v4.4 (Hacienda)
  | 'DO_ECF' // Dominican Republic — e-CF (DGII)
  | 'EC_FE' // Ecuador — Comprobantes electrónicos (SRI), clave de acceso
  | 'GT_FEL' // Guatemala — Factura Electrónica en Línea (SAT)
  | 'PA_FE' // Panama — Factura Electrónica FE/CF (DGI)
  | 'PY_DE' // Paraguay — Documento Electrónico / e-Kuatia (SIFEN)
  | 'SV_DTE' // El Salvador — DTE (JSON) (MH)
  | 'UY_CFE' // Uruguay — Comprobante Fiscal Electrónico / DFE (DGI)
  | 'VE_FE' // Venezuela — Factura Electrónica (SENIAT)
  // MENA
  | 'JO_JOFOTARA' // Jordan — JoFotara national e-invoice (ISTD)
  | 'TN_TEIF' // Tunisia — TEIF via TTN / El Fatoura
  | 'TR_EFATURA' // Turkey — UBL-TR e-Fatura / e-Arşiv (GİB)
  | 'EG_ETA' // Egypt — ETA e-invoice (signed JSON/XML)
  // Sub-Saharan Africa (mostly fiscal-device real-time)
  | 'NG_FIRS' // Nigeria — FIRS e-invoice (MBS)
  | 'KE_ETIMS' // Kenya — eTIMS (KRA)
  | 'GH_EVAT' // Ghana — E-VAT (GRA)
  | 'RW_EBM' // Rwanda — EBM (RRA)
  | 'TZ_VFD' // Tanzania — VFD (TRA)
  | 'UG_EFRIS' // Uganda — EFRIS (URA)
  | 'ZM_SMARTINVOICE' // Zambia — Smart Invoice (ZRA)
  | 'ZW_FDMS' // Zimbabwe — FDMS (ZIMRA)
  | 'CI_FNE' // Ivory Coast — FNE / SIGF (DGI)
  | 'BJ_MECEF' // Benin — e-MECeF (DGI)
  // Asia
  | 'ID_EFAKTUR' // Indonesia — e-Faktur / Coretax (DGT)
  | 'TW_EGUI' // Taiwan — eGUI / MIG unified invoice (NRA)
  | 'KZ_ESF' // Kazakhstan — ESF / IS ESF
  | 'PH_EIS' // Philippines — EIS JSON (BIR)
  | 'TH_ETAX' // Thailand — e-Tax Invoice & e-Receipt (RD)
  | 'NP_CBMS' // Nepal — CBMS (IRD)
  | 'BD_NBR' // Bangladesh — NBR e-invoice
  | 'PK_FBR' // Pakistan — FBR XIR
  | 'CN_EFAPIAO' // China — fully digitalized e-Fapiao (Golden Tax System IV, STA)
  | 'IN_IRP' // India — GST e-invoice JSON (INV-01) via IRP + IRN/QR
  | 'VN_TT78' // Vietnam — TT78 / Decree 123 e-invoice XML (GDT)
  // Europe (national, non-EN/Peppol)
  | 'ES_FACTURAE' // Spain — Facturae / SII / Verifactu (AEAT)
  | 'UA_TAXINVOICE' // Ukraine — tax-invoice XML (ЄРПН, DPS)
  | 'ME_FISCAL' // Montenegro — fiscalization XML
  | 'HR_ERACUN' // Croatia — e-Račun / Fiscalization 2.0
  | 'AL_FISCALIZATION' // Albania — fiscalization (CIS)
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
  | 'PROFORMA'
  | 'DEPOSIT'
  | 'FINAL'
  | 'PREPAYMENT'
  | 'SELF_BILLED'
  | 'EXPORT_INVOICE'
  | 'CASH_RECEIPT'
  | 'WITHHOLDING_RECEIPT'
  | 'PAYMENT_RECEIPT';
