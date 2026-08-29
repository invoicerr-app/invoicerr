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

/**
 * P2-T03 — WHICH duty an operation falls under, as distinct from HOW it is discharged.
 *
 * `RegimeModel` answers "how" (post-audit, clearance, decentralized CTC, reporting). It cannot
 * answer "which", and France needs both: over one domestic B2B operation there is an e-invoicing
 * duty (flux F1, CGI art. 289 bis) AND, on payment, an e-reporting duty (flux F10, art. 290) —
 * different deadlines, different corrections, different destinations. A single `regime` forces them
 * to be exclusive.
 *
 * NONE is not the absence of an obligation object; it is the explicit statement that an operation
 * carries no continuous-transaction duty at all, which is what POST_AUDIT means. Saying it is a
 * verdict; leaving the list empty would be a silence.
 */
export type ObligationKind = 'E_INVOICING' | 'E_REPORTING' | 'NONE';

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
  | 'PE_UBL' // Peru — Comprobante Electrónico UBL 2.1 (SUNAT/OSE), CDR
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

export type ChannelType = 'EMAIL' | 'PEPPOL' | 'GOV_PORTAL_API' | 'PAC' | 'PDP' | 'OSE' | 'SDI' | 'PRINT';

export type ReportingKind =
  | 'EC_SALES_LIST'
  | 'INTRASTAT'
  | 'OSS'
  | 'IOSS'
  | 'SAFT'
  | 'E_REPORTING'
  | 'SALES_PURCHASE_LEDGER'
  | 'CUSTOMS_EXPORT'
  // Spain (AEAT) — see profiles/data/es.ts and reporting/generators.ts.
  | 'SII' // Suministro Inmediato de Información — LibroRegistro (issued-invoice ledger) upload
  | 'VERIFACTU'; // RD 1007/2023 / Orden HAC/1177/2024 anti-fraud hash-chain register + reporting

export type Confidence = 'OFFICIAL' | 'BEST_EFFORT' | 'PLANNED' | 'FALLBACK' | 'UNVERIFIED';

export type TaxScheme = 'STANDARD' | 'FRANCHISE_BASE' | 'FLAT_RATE' | 'EXEMPT' | 'MARGIN' | 'OSS' | 'IOSS';

/**
 * How the issuer's own document number must behave.
 *
 * GAPLESS_SELF — the sequence must be chronological AND continue without gaps. Verified true only
 *   for France (CGI ann. II art. 242 nonies A, 7°, sanctioned by art. 1737, II).
 * UNIQUE_SELF  — the number must identify the document uniquely; a gap invalidates nothing.
 *   Germany (§ 14 Abs. 4 Nr. 4 UStG "einmalig"; UStAE 14.5: "eine lückenlose Abfolge … ist nicht
 *   zwingend"), Italy (art. 21 c. 2 lett. b DPR 633/72 "in modo univoco"; Ris. 1/E 10/01/2013),
 *   Poland (art. 106e ust. 1 pkt 2 "w ramach jednej lub więcej serii"; KSeF enforces uniqueness
 *   only), Mexico (Anexo 20: Serie and Folio are use="optional", "para control interno").
 * AUTHORITY_RANGE — the issuer consumes a range pre-allocated by the authority before issuing.
 *   NOTE: this is NOT the CFDI model. Mexico's UUID is assigned per document at clearance, not
 *   from a range; folio ranges belonged to the abrogated CFD/CBB regimes. Kept for jurisdictions
 *   that genuinely pre-allocate (e.g. Chile's CAF), and used by no shipped profile today.
 */
export type NumberingModel = 'GAPLESS_SELF' | 'UNIQUE_SELF' | 'AUTHORITY_RANGE';

export type CorrectionModel = 'CREDIT_NOTE' | 'CORRECTIVE_INVOICE' | 'CANCEL_AND_REPLACE';

/**
 * P3-T02 — the correction routes, sourced country by country in
 * `documentation/../docs/compliance/CORRECTION-ROUTES.yaml` (P3-T01).
 *
 * `CorrectionModel` above answers "which strategy builds the correcting document". It cannot answer
 * "which routes does this country open, require, or forbid", and P3-T01 established that the
 * distinction is not academic: THE SAME ROUTE IS REQUIRED IN ONE COUNTRY AND FORBIDDEN IN ANOTHER.
 * `INTERNAL_CREDIT_NOTE` is required in France (statuses Refusée/Rejetée, spécifications externes
 * DGFiP v3.2 §3.6.4) and in Italy (after a scarto, Provv. 89757/2018 punto 6.3) — and forbidden in
 * Poland (Podręcznik KSeF 2.0 §1.6.2), Spain (art. 24.1 RD 1624/1992) and Mexico. A single value
 * cannot hold that, and no per-country default can guess it.
 *
 * Four of these twelve were not in the plan's own list; the research found them. They are kept even
 * where no shipped profile uses them yet, because a route that exists in law and not in the
 * vocabulary is exactly how a country ends up hard-coded in a branch later.
 */
export type CorrectionRoute =
  | 'CREDIT_NOTE' // separate document that REDUCES, own number, transmitted
  | 'DEBIT_NOTE' // separate document that INCREASES — required in Italy, non-existent in Mexico
  | 'CORRECTIVE_INVOICE' // amends the original by reference (faktura korygująca, factura rectificativa)
  | 'CANCEL_AND_REPLACE' // void the original with the authority, issue a replacement
  | 'INTERNAL_CREDIT_NOTE' // accounting-only reversal whose transmission is FORBIDDEN
  | 'AUTHORITY_ANNULMENT' // request addressed to the authority against a filed document
  | 'RESUBMIT_SAME_IDENTITY' // after rejection, resend under the SAME number (and sometimes date)
  | 'LEDGER_ANNOTATION' // corrected in the registers, NO document at all (IT art. 26 c.7-8, ES art. 70)
  | 'NO_DOCUMENT_BY_LAW' // the tax adjusts by operation of law (DE § 17 Abs. 1) — the German default
  | 'COUNTERPARTY_OBJECTION' // the counterparty destroys the document (DE Widerspruch, unbefristet)
  | 'ANNOTATED_DUPLICATE' // the SAME document reissued annotated (FR duplicata, required on unpaid)
  | 'BUYER_CORRECTION_NOTE'; // issued by the BUYER (PL nota korygująca — repealed 2026-02-01)

/**
 * `UNVERIFIED` is a first-class answer, not a gap: it says nobody established this, and it must be
 * accompanied by what would settle it (guarded in data-integrity.spec.ts). The alternative — leaving
 * the route out — makes "not researched" indistinguishable from "not available".
 */
export type RouteStatus = 'REQUIRED' | 'OPEN' | 'FORBIDDEN' | 'UNVERIFIED';

/**
 * Which way the amount moves. Italy is the reason this axis exists: art. 26 DPR 633/72 comma 1 makes
 * the INCREASE an obligation ("devono essere osservate") while comma 2 leaves the DECREASE a faculty
 * ("ha diritto di"). Poland is the reason it is optional: art. 106j ust. 1 handles both directions
 * with one document, so its routes name no direction at all.
 */
export type VariationDirection = 'INCREASE' | 'DECREASE';

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

/**
 * A document kind as a PROFILE may name it — the shipped ones, or a code a country invents.
 *
 * `DocumentKind` above is the closed set the engine itself understands: it drives BT-3, the
 * correction strategies, the numbering series. But a jurisdiction is free to require a document that
 * exists nowhere else, and a closed union makes that a code change — which is precisely what "a
 * country is data" forbids. So a profile may declare any code; the engine treats an unknown one as
 * an ordinary document (BT-3 falls back to 380, see `documentTypeCode`) and the profile carries
 * whatever else is true about it.
 *
 * The `(string & {})` keeps editor completion on the known values while admitting the rest.
 */
export type DocumentKindCode = DocumentKind | (string & {});
