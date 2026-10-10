/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `reporting` section) - `countries/data/all.ts` is now the only place that reads or validates it,
 * and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly,
 * not this array. `ALL_REPORTING_OBLIGATION_FILES` below still exists, and still exports the exact
 * same content, purely for the handful of callers that import it directly instead of going through
 * `registry.ts` (`reporting/list-declarations.ts`, `countries/compose.spec.ts`) - it now DERIVES from
 * the composed catalog rather than reading a file itself, so there is nothing left here to validate:
 * that already happened once, centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryReportingObligationFile } from '../schema';

function reportingFromComposedCatalog(): CountryReportingObligationFile[] {
  const files: CountryReportingObligationFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const reporting = defaultComposedCountryCatalog.get(countryCode)?.reporting;
    if (reporting) files.push(reporting);
  }
  return files;
}

/** Every wired jurisdiction's reporting obligation, one file per country - see this module's own
 *  header. A country with no entry here has no obligation at all. */
export const ALL_REPORTING_OBLIGATION_FILES: CountryReportingObligationFile[] =
  reportingFromComposedCatalog();
