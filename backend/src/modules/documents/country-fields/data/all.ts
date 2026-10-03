/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `countryFields` section) - `countries/data/all.ts` is now the only place that reads or validates
 * it, and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog`
 * directly, not this array. `ALL_COUNTRY_FIELD_OVERLAY_FILES` below still exists, and still exports
 * the exact same content, purely for the handful of callers that import it directly instead of going
 * through `registry.ts` (`country-fields/supply-type-cross-border.spec.ts`,
 * `countries/compose.spec.ts`) - it now DERIVES from the composed catalog rather than reading a file
 * itself, so there is nothing left here to validate: that already happened once, centrally, in
 * `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryFieldOverlayFile } from '../schema';

function countryFieldsFromComposedCatalog(): CountryFieldOverlayFile[] {
  const files: CountryFieldOverlayFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const countryFields = defaultComposedCountryCatalog.get(countryCode)?.countryFields;
    if (countryFields) files.push(countryFields);
  }
  return files;
}

/** Every wired jurisdiction's field overlay, one file per country - see this module's own header. A
 *  country with NO entry here gets the trunk fields UNCHANGED. */
export const ALL_COUNTRY_FIELD_OVERLAY_FILES: CountryFieldOverlayFile[] = countryFieldsFromComposedCatalog();
