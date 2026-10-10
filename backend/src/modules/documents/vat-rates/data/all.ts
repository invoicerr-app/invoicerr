/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `vatRates` section) - `countries/data/all.ts` is now the only place that reads or validates it, and
 * `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly, not
 * this array. `ALL_VAT_RATE_FILES` below still exists, and still exports the exact same content,
 * purely for the handful of callers that import it directly instead of going through `registry.ts`
 * (`country-readiness.service.ts`, `tax/tax-systems/data/all.spec.ts`, `countries/compose.spec.ts`) -
 * it now DERIVES from the composed catalog rather than reading a file itself, so there is nothing
 * left here to validate: that already happened once, centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryVatRatesFile } from '../schema';

function vatRatesFromComposedCatalog(): CountryVatRatesFile[] {
  const files: CountryVatRatesFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const vatRates = defaultComposedCountryCatalog.get(countryCode)?.vatRates;
    if (vatRates) files.push(vatRates);
  }
  return files;
}

/** Every wired jurisdiction's VAT rate catalog, one file per country - see this module's own header.
 *  A country with NO entry here has no known catalog at all, which is exactly the "no known list, show
 *  an honest escape hatch, never a dead field" case descriptors/company-view.ts handles. */
export const ALL_VAT_RATE_FILES: CountryVatRatesFile[] = vatRatesFromComposedCatalog();
