/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `vatCurrency` section) - `countries/data/all.ts` is now the only place that reads or validates it,
 * and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly,
 * not this array. `ALL_VAT_CURRENCY_FILES` below still exists, and still exports the exact same
 * content, purely for the handful of callers that import it directly instead of going through
 * `registry.ts` (`countries/compose.spec.ts`) - it now DERIVES from the composed catalog rather than
 * reading a file itself, so there is nothing left here to validate: that already happened once,
 * centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryVatCurrencyFile } from '../schema';

function vatCurrencyFromComposedCatalog(): CountryVatCurrencyFile[] {
  const files: CountryVatCurrencyFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const vatCurrency = defaultComposedCountryCatalog.get(countryCode)?.vatCurrency;
    if (vatCurrency) files.push(vatCurrency);
  }
  return files;
}

/** Every wired jurisdiction's VAT-currency rule, one file per country - see this module's own header. */
export const ALL_VAT_CURRENCY_FILES: CountryVatCurrencyFile[] = vatCurrencyFromComposedCatalog();
