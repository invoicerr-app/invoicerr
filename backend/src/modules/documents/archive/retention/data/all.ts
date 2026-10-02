/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `retention` section) - `countries/data/all.ts` is now the only place that reads or validates it,
 * and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly,
 * not this array. `ALL_RETENTION_FILES` below still exists, and still exports the exact same
 * content, purely for the handful of callers that import it directly instead of going through
 * `registry.ts` (`countries/compose.spec.ts`) - it now DERIVES from the composed catalog rather than
 * reading a file itself, so there is nothing left here to validate: that already happened once,
 * centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../../countries/registry';
import { CountryRetentionFile } from '../schema';

function retentionFromComposedCatalog(): CountryRetentionFile[] {
  const files: CountryRetentionFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const retention = defaultComposedCountryCatalog.get(countryCode)?.retention;
    if (retention) files.push(retention);
  }
  return files;
}

/** Every wired jurisdiction's retention durations, one file per country - see this module's own
 *  header. A country with no entry here has NO declared rule at all. */
export const ALL_RETENTION_FILES: CountryRetentionFile[] = retentionFromComposedCatalog();
