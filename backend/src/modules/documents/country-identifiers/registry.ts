import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryIdentifierRequirementsFile, IdentifierSchemeFact } from './schema';
import { byCodeUnit } from '@/lib/compare';

function buildIndex(
  files: CountryIdentifierRequirementsFile[],
): Record<string, CountryIdentifierRequirementsFile> {
  const index: Record<string, CountryIdentifierRequirementsFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 5): every country's own `identifiers` section from
 * the composed per-country view, instead of this catalog's own `data/all.ts` directly. No import
 * cycle results, because `countries/compose.ts` reads the RAW loader
 * (`country-identifiers/data/all.ts`'s own `ALL_COUNTRY_IDENTIFIER_FILES`), never this registry: see
 * that file's own header. The dependency direction is therefore one-way: this file depends on
 * `countries/registry.ts`, which depends on `countries/compose.ts`, which depends on
 * `country-identifiers/data/all.ts`; nothing depends back on this file from inside that chain, the
 * same shape `vat-rates/registry.ts` (step 2) and `country-fields/registry.ts` (step 3) already
 * proved. `seedCountryIdentifierRequirements`, `boot-reseed.ts` and
 * `backend/scripts/release-catalogs.ts` all read `defaultCountryIdentifierRequirementsCatalog`
 * below, never `data/all.ts` directly, so none of those three need any change for this step: only
 * where the no-argument default reads from moves. A country with no `identifiers` section in the
 * composed view is simply left out here, the same "no permissive fallback" this catalog already
 * held when it read `ALL_COUNTRY_IDENTIFIER_FILES` directly.
 */
function countryIdentifierRequirementsFromComposedCatalog(): CountryIdentifierRequirementsFile[] {
  const files: CountryIdentifierRequirementsFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const identifiers = defaultComposedCountryCatalog.get(countryCode)?.identifiers;
    if (identifiers) files.push(identifiers);
  }
  return files;
}

/**
 * In-memory view of the identifier-requirements files — the same role CountryPolicyCatalog
 * (country-policy/registry.ts) plays for action rules. The seed (seedCountryIdentifierRequirements)
 * reads `countries()`/`schemesFor()` to make the database match the files exactly;
 * `country-identifiers.ts`'s runtime resolver reads the DATABASE, never this catalog directly — see
 * that file's header for why the split matters (a boot-time catalog and a per-request read are
 * different concerns, the same separation country-policy/registry.ts already documents).
 *
 * The constructor still takes a plain `CountryIdentifierRequirementsFile[]` (never the composed
 * catalog itself), so an explicit, smaller list still works exactly as before for every existing
 * caller and test (e.g. `new CountryIdentifierRequirementsCatalog([FR_FILE])`): only the
 * NO-ARGUMENT default changed where it reads from.
 */
export class CountryIdentifierRequirementsCatalog {
  private readonly files: Record<string, CountryIdentifierRequirementsFile>;

  constructor(
    files: CountryIdentifierRequirementsFile[] = countryIdentifierRequirementsFromComposedCatalog(),
  ) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have an identifier-requirements file — sorted, for stable test/seed
   *  iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort(byCodeUnit);
  }

  /** Every identifier-scheme fact declared for a country, in file order. Empty for a country with
   *  no file at all. */
  schemesFor(countryCode: string): IdentifierSchemeFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.schemes ?? [];
  }
}

export const defaultCountryIdentifierRequirementsCatalog = new CountryIdentifierRequirementsCatalog();
