/**
 * Ivory Coast (CI) — Sub-Saharan Africa.
 * FNE / SIGF
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CI: CountryComplianceProfile = realTime('CI', 'Ivory Coast', {
  syntax: 'CI_FNE',
  providerId: 'ci-dgi',
  tax: vat(18),
});
