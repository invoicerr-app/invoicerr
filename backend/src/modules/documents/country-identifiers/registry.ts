import { ALL_COUNTRY_IDENTIFIER_FILES } from './data/all';
import { CountryIdentifierRequirementsFile, IdentifierSchemeFact } from './schema';

function buildIndex(
  files: CountryIdentifierRequirementsFile[],
): Record<string, CountryIdentifierRequirementsFile> {
  const index: Record<string, CountryIdentifierRequirementsFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the identifier-requirements files — the same role CountryPolicyCatalog
 * (country-policy/registry.ts) plays for action rules. The seed (seedCountryIdentifierRequirements)
 * reads `countries()`/`schemesFor()` to make the database match the files exactly;
 * `country-identifiers.ts`'s runtime resolver reads the DATABASE, never this catalog directly — see
 * that file's header for why the split matters (a boot-time catalog and a per-request read are
 * different concerns, the same separation country-policy/registry.ts already documents).
 */
export class CountryIdentifierRequirementsCatalog {
  private readonly files: Record<string, CountryIdentifierRequirementsFile>;

  constructor(files: CountryIdentifierRequirementsFile[] = ALL_COUNTRY_IDENTIFIER_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have an identifier-requirements file — sorted, for stable test/seed
   *  iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Every identifier-scheme fact declared for a country, in file order. Empty for a country with
   *  no file at all. */
  schemesFor(countryCode: string): IdentifierSchemeFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.schemes ?? [];
  }
}

export const defaultCountryIdentifierRequirementsCatalog = new CountryIdentifierRequirementsCatalog();
