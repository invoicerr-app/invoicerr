/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `domesticReverseCharge` section) - `countries/data/all.ts` is now the only place that reads or
 * validates it, and `registry.ts`'s own default constructor already reads
 * `defaultComposedCountryCatalog` directly, not this array. `ALL_DOMESTIC_REVERSE_CHARGE_FILES` below
 * still exists, and still exports the exact same content, purely for the handful of callers that
 * import it directly instead of going through `registry.ts` (`countries/compose.spec.ts`) - it now
 * DERIVES from the composed catalog rather than reading a file itself, so there is nothing left here
 * to validate: that already happened once, centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryDomesticReverseChargeFile } from '../schema';

function domesticReverseChargeFromComposedCatalog(): CountryDomesticReverseChargeFile[] {
  const files: CountryDomesticReverseChargeFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const domesticReverseCharge = defaultComposedCountryCatalog.get(countryCode)?.domesticReverseCharge;
    if (domesticReverseCharge) files.push(domesticReverseCharge);
  }
  return files;
}

/** Every wired jurisdiction's domestic reverse-charge categories, one file per country - see this
 *  module's own header. A country with no entry here has NO known category. */
export const ALL_DOMESTIC_REVERSE_CHARGE_FILES: CountryDomesticReverseChargeFile[] =
  domesticReverseChargeFromComposedCatalog();
