/**
 * Kenya (KE) — Sub-Saharan Africa.
 * eTIMS
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const KE: CountryComplianceProfile = realTime('KE', 'Kenya', {
  from: '2022-01-01',
  syntax: 'KE_ETIMS',
  providerId: 'ke-kra',
  tax: vat(16),
});
