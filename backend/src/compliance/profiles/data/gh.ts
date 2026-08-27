/**
 * Ghana (GH) — Sub-Saharan Africa.
 * GRA E-VAT
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const GH: CountryComplianceProfile = realTime('GH', 'Ghana', {
  syntax: 'GH_EVAT',
  providerId: 'gh-gra',
  tax: vat(15),
});
