/**
 * The tax-engine's own canonical types — cross-border tax, CARRIED OVER from the
 * removed compliance engine's `compliance/canonical/canonical-document.ts` and `compliance/types.ts`
 * (git tag `avant-refonte-documents`), narrowed to exactly what `tax-engine.ts`/`classification.ts`
 * consume. The old files carried a much larger canonical DOCUMENT model (formats, transmission,
 * lifecycle, archival...) that this branch's generic descriptor system does not need and does not
 * have — see `documents/tax/tax-engine.ts`'s own header for why only the TAX slice survives, ported
 * rather than reinvented, into types this module actually uses.
 *
 * Kept field-for-field identical in spirit to the reference so `tax-engine.ts`/`classification.ts` could
 * be pasted across with only import paths changing — never re-derived from memory.
 */

export type ISO3166Alpha2 = string;

export type PartyRole = 'B2B' | 'B2C';

/** The invoice descriptor only ever produces 'GOODS' | 'SERVICES' today (see
 *  `formats/semantic/supply-type.ts`) — 'DIGITAL' is kept from the reference's own type because the
 *  engine's OSS branch treats it identically to 'GOODS' (see `tax-engine.ts`), and a future digital
 *  supply overlay should not need this type widened again. Nothing in this branch's wiring produces
 *  'DIGITAL' today; it is unreachable, not unused. */
export type SupplyType = 'GOODS' | 'SERVICES' | 'DIGITAL';

/** EN 16931 BT-151 (`cac:ClassifiedTaxCategory/cbc:ID`) — UNCL 5305 VAT category codes. */
export type TaxCategoryCode = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O';

export type TaxSystemKind = 'VAT' | 'GST' | 'SALES_TAX' | 'NONE';

export type TaxScheme = 'STANDARD' | 'FRANCHISE_BASE' | 'EXEMPT';

/**
 * WHERE a seller's intra-Community DISTANCE SALES to consumers are taxed — the one fact
 * `tax-engine.ts`'s own "B2C across the union" branch cannot derive from the two countries alone.
 *
 * Directive 2006/112/EC art. 33(a) (as amended by Directive (EU) 2017/2455) makes the place of supply
 * of an intra-Community distance sale of goods "the place where the goods are located at the time when
 * dispatch or transport of the goods to the customer ends" — the BUYER's member state. Art. 59c(1)
 * then disapplies that rule (and art. 58, the equivalent rule for telecommunications, broadcasting and
 * electronically supplied services) for a small seller: "Point (a) of Article 33 and Article 58 shall
 * not apply, where the following conditions are met: (a) the supplier is established or, in the absence
 * of an establishment, has his permanent address or usually resides only in one Member State; (b)
 * services are supplied to non-taxable persons who are established […] in any Member State other than
 * the Member State referred to in point (a) or goods are dispatched or transported to a Member State
 * other than the Member State referred to in point (a); and (c) the total value, exclusive of VAT, of
 * the supplies referred to in point (b) does not in the current calendar year exceed EUR 10 000, or the
 * equivalent in national currency, nor did it do so in the course of the preceding calendar year."
 * With art. 33(a) disapplied, the general rule of art. 32 governs — "the place where the goods are
 * located at the time when dispatch or transport of the goods to the customer begins", i.e. the
 * SELLER's own member state, at the SELLER's own rate. (Read from the consolidated Directive on
 * EUR-Lex, CELEX 02006L0112, 2026-09-21; France transposes both halves at CGI art. 258 A, I, 1° for
 * goods and art. 259 D, II for the services side — see `resolve-invoice-tax.ts` for that citation.)
 *
 * TWO facts decide which of the two applies, and NEITHER can be read off an invoice:
 *  - the EUR 10 000 ceiling is a RUNNING TOTAL, per seller, per calendar year, across every member
 *    state combined, and it bites the moment it is crossed (art. 59c(2): "Where, during a calendar
 *    year, the threshold referred to in point (c) of paragraph 1 is exceeded, point (a) of Article 33
 *    and Article 58 shall apply as of that time") — it counts sales this instance may never have seen,
 *    so computing it from one instance's own invoice history would be a confident wrong answer;
 *  - a seller UNDER the threshold may still opt for destination taxation (art. 59c(3): member states
 *    "shall grant taxable persons carrying out supplies eligible under paragraph 1 the right to opt for
 *    the place of supply to be determined in accordance with point (a) of Article 33 and Article 58,
 *    which shall in any event cover two calendar years") — a legal act by the seller, never a number.
 *
 * So this is a DECLARATION the seller makes, carried on its own party profile. It is deliberately NOT
 * a `tax-systems/data/<country>.json` fact, this module's "a country is data" principle
 * notwithstanding: the countries are already data here, and art. 59c applies identically in all of
 * them — what the rule actually turns on is the SELLER.
 */
export type DistanceSalesRegime = 'ORIGIN' | 'DESTINATION';

/** A narrowed `ReportingKind` — only the flags the tax engine itself ever emits. The reference's own
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
  /** SELLER side only in practice — the seller's own declared intra-Community distance-sales regime
   *  (see `DistanceSalesRegime` above for the two articles and why it can only be a declaration).
   *  `undefined` is "never declared", which `tax-engine.ts` treats as DESTINATION purely to preserve
   *  its own historic behaviour as a total function — `resolve-invoice-tax.ts` refuses an undeclared
   *  regime before the engine is ever called on the one branch that reads it. */
  distanceSalesRegime?: DistanceSalesRegime;
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
  /** See `profiles/data/fr.ts` in the removed compliance engine (verbatim source of this field) —
   *  `false` means the country levies NO zero rate today, so a 0% domestic line cannot be category `Z` (see
   *  `tax-engine.ts#domesticCategoryFor`). Absent/`undefined` (not established) behaves like the
   *  reference's own default: `Z` stays the answer, never re-classified on a guess. */
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
