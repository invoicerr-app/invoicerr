import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryPaymentTermsFile } from './schema';

/** The country's payment-term cap, or `null` for a country whose file has no `paymentTerms` section:
 *  no known cap, never a guessed one. */
export function paymentTermsCapFor(countryCode: string): CountryPaymentTermsFile | null {
  return defaultComposedCountryCatalog.get(countryCode)?.paymentTerms ?? null;
}
