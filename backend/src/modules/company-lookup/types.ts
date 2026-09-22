/**
 * Country-aware company lookup — shared types.
 *
 * One port, many national registries. Each country's official business register
 * (or the EU-wide VIES service) is wrapped in a `CompanyRegistryProvider` that
 * turns a national identifier into the same normalized `CompanyLookupCompany`,
 * so the onboarding / client forms never learn a country-specific shape.
 *
 * Identifier schemes match the ones the compliance profiles declare in
 * `requiredIdentifiers` (compliance/profiles/schema.ts): LEGAL_ID (the national
 * registration number — SIRET, IČO, NIP, CVR, CNPJ…) and VAT.
 */

export type LookupScheme = 'LEGAL_ID' | 'VAT';

export interface CompanyLookupQuery {
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  scheme: LookupScheme;
  /** Raw user input — providers normalize it themselves. */
  value: string;
}

export interface CompanyLookupCompany {
  /** Trading / display name. */
  name: string;
  /** Registered legal name when the registry distinguishes it from `name`. */
  legalName?: string;
  /** National registration number, normalized (digits only where applicable). */
  legalId?: string;
  /** The national scheme `legalId` belongs to, e.g. 'SIRET', 'ICO', 'NIP', 'CVR'. */
  legalIdScheme?: string;
  /** VAT number including the country prefix where the registry exposes one. */
  VAT?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  /** Country display name. */
  country?: string;
  countryCode?: string;
  foundedAt?: Date;
  /** Registry status when published: is the entity still trading? */
  status?: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  /**
   * VAT registration as reported by the registry (VIES `isValid`, PL statusVat…).
   * null = the source could not tell.
   */
  vatRegistered?: boolean | null;
}

export type LookupErrorCode =
  /** No provider serves this country (no public registry API exists). */
  | 'UNSUPPORTED_COUNTRY'
  /** A provider exists but its credentials are not configured on this instance. */
  | 'NOT_CONFIGURED'
  /** The identifier failed the provider's structural check — never left the process. */
  | 'INVALID_IDENTIFIER'
  /** Network error, timeout, rate limit or unexpected status from the registry. */
  | 'PROVIDER_ERROR';

export interface CompanyLookupResult {
  found: boolean;
  company: CompanyLookupCompany | null;
  /** Provider id that answered first (or was tried last). */
  source?: string;
  /** Every provider that contributed a field, e.g. 'VIES (EU VAT validation) + GLEIF'. */
  sourceLabel?: string;
  sources?: string[];
  error?: LookupErrorCode;
  /** Human-readable detail for the error — safe to surface in a toast. */
  message?: string;
}

/** Thrown by providers for a reachable-but-unusable registry; the service maps it to a result. */
export class ProviderLookupError extends Error {
  constructor(
    readonly code: Exclude<LookupErrorCode, 'UNSUPPORTED_COUNTRY'>,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderLookupError';
  }
}

/**
 * How much of a country's business population a provider can answer for.
 *   REGISTER — the official register: every registered company is in it.
 *   PARTIAL  — a global directory (LEI, Peppol): only entities that opted in are there.
 */
export type ProviderCoverage = 'REGISTER' | 'PARTIAL';

export interface CompanyRegistryProvider {
  /** Stable id, used in API responses and env var namespacing. e.g. 'fr-recherche-entreprises'. */
  readonly id: string;
  /** Registry name shown to the user, e.g. 'Companies House'. */
  readonly label: string;
  /** ISO 3166-1 alpha-2 codes this provider can answer for, or 'ALL' for a worldwide directory. */
  readonly countries: readonly string[] | 'ALL';
  /** Defaults to REGISTER when omitted. */
  readonly coverage?: ProviderCoverage;
  readonly schemes: readonly LookupScheme[];
  /** What the user must type, e.g. 'SIRET (14 digits)'. */
  readonly identifierLabel: string;
  readonly docsUrl?: string;
  /** Env vars that must be set for this provider to run. Empty = keyless. */
  readonly credentialEnvVars?: readonly string[];

  /** False when a required credential is missing — the registry then falls through. */
  isConfigured(): boolean;
  /** Structural check; false means "not my kind of identifier", not "not found". */
  supports(query: CompanyLookupQuery): boolean;
  /** Resolves to null when the registry answered "no such entity". */
  lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null>;
}

export type CountryLookupStatus =
  /** At least one provider is wired and configured right now (see `coverage` for how complete). */
  | 'AVAILABLE'
  /** A provider exists but needs credentials this instance does not have. */
  | 'NEEDS_CREDENTIALS'
  /** No public API — the user fills the form by hand. */
  | 'UNAVAILABLE';

export interface ProviderCapability {
  id: string;
  label: string;
  coverage: ProviderCoverage;
  schemes: readonly LookupScheme[];
  identifierLabel: string;
  docsUrl?: string;
  requiresCredentials: boolean;
  credentialEnvVars?: readonly string[];
  configured: boolean;
}

export interface CountryLookupCapability {
  countryCode: string;
  status: CountryLookupStatus;
  /**
   * REGISTER when the country's own register answers, PARTIAL when only the worldwide
   * directories do — the button still works, but most small businesses are not in them.
   */
  coverage: ProviderCoverage;
  /** Ordered as they will be tried. */
  providers: ProviderCapability[];
  /** Schemes at least one *configured* provider accepts. */
  schemes: LookupScheme[];
  /** Prompt for the input field, taken from the first usable provider. */
  identifierLabel?: string;
  /** Why nothing is available, or what the available data is limited to. */
  note?: string;
}
