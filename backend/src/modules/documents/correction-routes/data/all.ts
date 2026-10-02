/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `correctionRoutes` section) - `countries/data/all.ts` is now the only place that reads or validates
 * it, and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog`
 * directly, not this array. `ALL_CORRECTION_ROUTES_FILES` below still exists, and still exports the
 * exact same content, purely for the handful of callers that import it directly instead of going
 * through `registry.ts` (`country-readiness.service.ts`, `countries/compose.spec.ts`) - it now
 * DERIVES from the composed catalog rather than reading a file itself, so there is nothing left here
 * to validate: that already happened once, centrally, in `countries/data/all.ts`.
 *
 * The load-time-gate proof this file used to carry directly (`loadCountryFile`, mocked at the
 * `node:fs` boundary, proving an invented eighth country with no provenance refuses to load) moved
 * with the mechanism it was proving: see `countries/data/all.spec.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryCorrectionRoutesFile } from '../schema';

function correctionRoutesFromComposedCatalog(): CountryCorrectionRoutesFile[] {
  const files: CountryCorrectionRoutesFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const correctionRoutes = defaultComposedCountryCatalog.get(countryCode)?.correctionRoutes;
    if (correctionRoutes) files.push(correctionRoutes);
  }
  return files;
}

/** Every wired jurisdiction's correction-routes file, one file per country - see this module's own
 *  header. */
export const ALL_CORRECTION_ROUTES_FILES: CountryCorrectionRoutesFile[] =
  correctionRoutesFromComposedCatalog();
