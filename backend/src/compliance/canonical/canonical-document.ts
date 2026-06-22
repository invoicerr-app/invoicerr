/**
 * The internal, format-agnostic semantic document (COMPLIANCE_ARCHITECTURE.md §6).
 * Everything maps to/from this; no business logic ever speaks UBL/CFDI/FatturaPA directly.
 */
import {
  DocumentKind,
  ISO3166Alpha2,
  PartyRole,
  ReportingKind,
  SupplyType,
  TaxCategoryCode,
  TaxScheme,
  TaxSystemKind,
} from '../types';

/** Money is ALWAYS integer minor units + the currency's decimal count — never a float. */
export interface Money {
  minor: number; // amount in the smallest currency unit (e.g. cents)
  currency: string; // ISO 4217
  decimals: number; // 2 for EUR/USD, 0 for JPY, 3 for KWD/BHD
}

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
  /** Jurisdiction governing the supply for this party (registration relevant to the supply). */
  countryCode: ISO3166Alpha2;
  establishmentCountry?: ISO3166Alpha2;
  role: PartyRole;
  identifiers: PartyIdentifier[];
  taxScheme?: TaxScheme;
  address?: StructuredAddress;
  peppolId?: string;
}

export interface DocumentLine {
  id: string;
  description: string;
  quantity: number;
  unitNetMinor: number; // unit net price, minor units
  supplyType: SupplyType;
  taxRateHint?: number; // explicit rate (e.g. a reduced rate); domestic falls back to standard
  taxCategoryHint?: TaxCategoryCode;
}

/** One tax on a line — a single line may carry several at once (BR, IN, US local). */
export interface TaxComponent {
  taxSystem: TaxSystemKind;
  name: string; // VAT / IVA / Sales Tax / ICMS ...
  category: TaxCategoryCode;
  rate: number; // percent
  baseMinor?: number; // taxable base if different from line net
  reason?: string; // exemption reason code (VATEX-…)
  jurisdiction: ISO3166Alpha2;
  subdivision?: string;
}

export interface LegalMention {
  code: string; // machine tag, e.g. REVERSE_CHARGE, FR_293B, EXPORT, OUT_OF_SCOPE
  text: string; // human text rendered on the document
}

/** The Tax Engine's per-line verdict. */
export interface TaxTreatment {
  components: TaxComponent[]; // ≥1
  buyerSelfAssess: boolean; // reverse charge / import: buyer accounts for the tax
  reportingFlags: ReportingKind[];
  mentions: LegalMention[];
}

/** Everything the engine needs to resolve obligations for one transaction. */
export interface TransactionContext {
  supplier: PartyTaxProfile;
  buyer: PartyTaxProfile;
  lines: DocumentLine[];
  issueDate: Date;
  currency: string;
  documentKind?: DocumentKind;
}
