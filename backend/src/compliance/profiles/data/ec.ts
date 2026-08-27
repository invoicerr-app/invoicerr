/**
 * Ecuador (EC) — Latin America.
 * SRI
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const EC: CountryComplianceProfile = clearance('EC', 'Ecuador', {
  syntax: 'EC_FE',
  providerId: 'sri',
  tax: vat(15),
});
