/**
 * Uganda (UG) — Sub-Saharan Africa.
 * EFRIS
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const UG: CountryComplianceProfile = realTime('UG', 'Uganda', {
  syntax: 'UG_EFRIS',
  providerId: 'ug-ura',
  tax: vat(18),
});
