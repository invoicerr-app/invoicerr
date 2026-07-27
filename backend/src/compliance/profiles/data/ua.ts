/**
 * Ukraine (UA) — Europe.
 * VAT invoice registration (ЄРПН) blocks
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const UA: CountryComplianceProfile = clearance('UA', 'Ukraine', {
  syntax: 'UA_TAXINVOICE',
  providerId: 'ua-dps',
  tax: vat(20, [7]),
});
