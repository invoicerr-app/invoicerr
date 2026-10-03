/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `taxSystem` section) - `countries/data/all.ts` is now the only place that reads or validates it,
 * and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly,
 * not this array. `ALL_TAX_SYSTEM_FILES` below still exists, and still exports the exact same
 * content, purely for the handful of callers that import it directly instead of going through
 * `registry.ts` (`country-readiness.service.ts`, `tax/distance-sales-regime.spec.ts`,
 * `tax/resolve-invoice-tax.spec.ts`, `countries/compose.spec.ts`) - it now DERIVES from the composed
 * catalog rather than reading a file itself, so there is nothing left here to validate: that already
 * happened once, centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../../countries/registry';
import { CountryTaxSystemFact } from '../schema';

function taxSystemFromComposedCatalog(): CountryTaxSystemFact[] {
  const files: CountryTaxSystemFact[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const taxSystem = defaultComposedCountryCatalog.get(countryCode)?.taxSystem;
    if (taxSystem) files.push(taxSystem);
  }
  return files;
}

/** Every wired jurisdiction's tax-system fact, one file per country - see this module's own header. A
 *  country with NO entry here has no known tax-system profile at all. */
export const ALL_TAX_SYSTEM_FILES: CountryTaxSystemFact[] = taxSystemFromComposedCatalog();
