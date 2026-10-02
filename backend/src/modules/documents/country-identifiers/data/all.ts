/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `identifiers` section) - `countries/data/all.ts` is now the only place that reads or validates it,
 * and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly,
 * not this array. `ALL_COUNTRY_IDENTIFIER_FILES` below still exists, and still exports the exact same
 * content, purely for the handful of callers that import it directly instead of going through
 * `registry.ts` (`country-readiness.service.ts`, `formats/national/fatturapa-provider.spec.ts`,
 * `countries/compose.spec.ts`) - it now DERIVES from the composed catalog rather than reading a file
 * itself, so there is nothing left here to validate: that already happened once, centrally, in
 * `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryIdentifierRequirementsFile } from '../schema';

function identifiersFromComposedCatalog(): CountryIdentifierRequirementsFile[] {
  const files: CountryIdentifierRequirementsFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const identifiers = defaultComposedCountryCatalog.get(countryCode)?.identifiers;
    if (identifiers) files.push(identifiers);
  }
  return files;
}

/** Every wired jurisdiction's identifier requirements, one file per country - see this module's own
 * header. A country with NO entry here has no requirements at all - see
 *  country-identifiers.ts's resolveRequiredIdentifiers for how that state is surfaced. */
export const ALL_COUNTRY_IDENTIFIER_FILES: CountryIdentifierRequirementsFile[] =
  identifiersFromComposedCatalog();
