/**
 * Every country's reporting section, read from `countries/data/<cc>.json` through the composed
 * catalog (`countries/data/all.ts` already validated each one at load), in the v2 obligation shape.
 * Since issue #768 the shipped files are written in v2; a section still in the legacy `facts` shape is
 * upgraded here with `upgradeLegacyFacts`, so every reader sees v2. Kept for the callers that import
 * the array directly instead of going through `obligation-catalog.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryReportingObligationFileV2, isV2ReportingSource, upgradeLegacyFacts } from '../obligation-v2';

function reportingFromComposedCatalog(): CountryReportingObligationFileV2[] {
  const files: CountryReportingObligationFileV2[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const reporting = defaultComposedCountryCatalog.get(countryCode)?.reporting;
    // A section still written in legacy `facts` is upgraded here, so every reader sees v2 (#768).
    if (reporting) files.push(isV2ReportingSource(reporting) ? reporting : upgradeLegacyFacts(reporting));
  }
  return files;
}

/** Every wired jurisdiction's reporting obligation, one file per country - see this module's own
 *  header. A country with no entry here has no obligation at all. */
export const ALL_REPORTING_OBLIGATION_FILES: CountryReportingObligationFileV2[] =
  reportingFromComposedCatalog();
