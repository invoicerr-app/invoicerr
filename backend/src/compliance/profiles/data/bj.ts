/**
 * Benin (BJ) — Sub-Saharan Africa.
 * e-MECeF
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BJ: CountryComplianceProfile = realTime('BJ', 'Benin', {
  syntax: 'BJ_MECEF',
  providerId: 'bj-dgi',
  tax: vat(18),
});
