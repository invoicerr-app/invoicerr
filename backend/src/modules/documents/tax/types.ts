/**
 * The tax-engine's own canonical types — root TODO item 16 ("transfrontalier"), REPRISE of the
 * removed compliance engine's `compliance/canonical/canonical-document.ts` and `compliance/types.ts`
 * (git tag `avant-refonte-documents`), narrowed to exactly what `tax-engine.ts`/`classification.ts`
 * consume. The old files carried a much larger canonical DOCUMENT model (formats, transmission,
 * lifecycle, archival...) that this branch's generic descriptor system does not need and does not
 * have — see `documents/tax/tax-engine.ts`'s own header for why only the TAX slice survives, ported
 * rather than reinvented, into types this module actually uses.
 *
 * Kept field-for-field identical in spirit to the repère so `tax-engine.ts`/`classification.ts` could
 * be pasted across with only import paths changing — never re-derived from memory.
 */

export type ISO3166Alpha2 = string;

export type PartyRole = 'B2B' | 'B2C';

/** The invoice descriptor only ever produces 'GOODS' | 'SERVICES' today (see
 *  `formats/semantic/supply-type.ts`) — 'DIGITAL' is kept from the repère's own type because the
 *  engine's OSS branch treats it identically to 'GOODS' (see `tax-engine.ts`), and a future digital
 *  supply overlay should not need this type widened again. Nothing in this branch's wiring produces
 *  'DIGITAL' today; it is unreachable, not unused. */
export type SupplyType = 'GOODS' | 'SERVICES' | 'DIGITAL';

/** EN 16931 BT-151 (`cac:ClassifiedTaxCategory/cbc:ID`) — UNCL 5305 VAT category codes. */
export type TaxCategoryCode = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O';

export type TaxSystemKind = 'VAT' | 'GST' | 'SALES_TAX' | 'NONE';

export type TaxScheme = 'STANDARD' | 'FRANCHISE_BASE' | 'EXEMPT';

/** A narrowed `ReportingKind` — only the flags the tax engine itself ever emits. The repère's own
 *  enum carried many more (e-invoicing/e-reporting transmission flags) that belonged to the removed
 *  lifecycle engine, not to tax determination. */
export type ReportingKind = 'EC_SALES_LIST' | 'INTRASTAT' | 'OSS' | 'CUSTOMS_EXPORT';

export interface PartyIdentifier {
  scheme: string; // 'VAT' | 'SIREN' | 'SIRET' | 'EIN' | 'RFC' | 'PEPPOL' ...
  value: string;
  validated?: boolean; // VIES / registry check result (undefined = unchecked)
}

export interface StructuredAddress {
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  subdivision?: string; // US state / BR UF / CA province
  countryCode: ISO3166Alpha2;
}

export interface PartyTaxProfile {
  legalName: string;
  countryCode: ISO3166Alpha2;
  role: PartyRole;
  identifiers: PartyIdentifier[];
  taxScheme?: TaxScheme;
  address?: StructuredAddress;
}

export interface DocumentLine {
  id: string;
  description: string;
  quantity: number;
  unitNetMinor: number;
  supplyType: SupplyType;
  taxRateHint?: number;
  taxCategoryHint?: TaxCategoryCode;
  taxExemptionReasonHint?: string;
}

export interface TaxComponent {
  taxSystem: TaxSystemKind;
  name: string; // VAT / IVA / Sales Tax / ICMS ...
  category: TaxCategoryCode;
  rate: number; // percent
  baseMinor?: number;
  reason?: string;
  jurisdiction: ISO3166Alpha2;
  subdivision?: string;
}

export interface LegalMention {
  code: string; // machine tag, e.g. REVERSE_CHARGE, EXPORT, OUT_OF_SCOPE
  text: string; // human text rendered on the document
}

export interface TaxTreatment {
  components: TaxComponent[]; // >= 1
  buyerSelfAssess: boolean;
  reportingFlags: ReportingKind[];
  mentions: LegalMention[];
}

export interface TransactionContext {
  supplier: PartyTaxProfile;
  buyer: PartyTaxProfile;
  lines: DocumentLine[];
  issueDate: Date;
  currency: string;
}

// --- Tax-system specs (the slice of `CountryComplianceProfile` this module needs) ---

export interface VatSystemSpec {
  kind: 'VAT' | 'GST';
  standardRate: number;
  reducedRates: number[];
  schemes: TaxScheme[];
  /** See `profiles/data/fr.ts` at the repère (verbatim source of this field) — `false` means the
   *  country levies NO zero rate today, so a 0% domestic line cannot be category `Z` (see
   *  `tax-engine.ts#domesticCategoryFor`). Absent/`undefined` (not established) behaves like the
   *  repère's own default: `Z` stays the answer, never re-classified on a guess. */
  hasDomesticZeroRate?: boolean;
}

export interface SalesTaxSystemSpec {
  kind: 'SALES_TAX';
  stateRates: Record<string, number>;
  nexusSubdivisions?: string[];
}

export interface NoTaxSystemSpec {
  kind: 'NONE';
}

export type TaxSystemSpec = VatSystemSpec | SalesTaxSystemSpec | NoTaxSystemSpec;

/** The narrow slice of the removed `CountryComplianceProfile` this engine actually reads — see
 *  `tax-systems/schema.ts` for the sourced, provenance-carrying catalog this is loaded from. */
export interface CountryTaxSystemProfile {
  countryCode: ISO3166Alpha2;
  taxSystem: TaxSystemSpec;
}
