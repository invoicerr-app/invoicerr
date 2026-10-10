/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `contentRequirements` section) - `countries/data/all.ts` is now the only place that reads or
 * validates it, and `registry.ts`'s own default constructor already reads
 * `defaultComposedCountryCatalog` directly, not this array. `ALL_CONTENT_REQUIREMENT_FILES` below
 * still exists, and still exports the exact same content, purely for the handful of callers that
 * import it directly instead of going through `registry.ts` (`countries/compose.spec.ts`) - it now
 * DERIVES from the composed catalog rather than reading a file itself, so there is nothing left here
 * to validate: that already happened once, centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryContentRequirementsFile } from '../schema';

function contentRequirementsFromComposedCatalog(): CountryContentRequirementsFile[] {
  const files: CountryContentRequirementsFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const contentRequirements = defaultComposedCountryCatalog.get(countryCode)?.contentRequirements;
    if (contentRequirements) files.push(contentRequirements);
  }
  return files;
}

/** Every wired jurisdiction's content requirements, one file per country - see this module's own
 *  header. A country with no entry here has no requirement at all. */
export const ALL_CONTENT_REQUIREMENT_FILES: CountryContentRequirementsFile[] =
  contentRequirementsFromComposedCatalog();
