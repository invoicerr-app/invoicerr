/**
 * Nigeria (NG) — Sub-Saharan Africa.
 * FIRS e-invoicing
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const NG: CountryComplianceProfile = clearance('NG', 'Nigeria', {
  from: '2024-01-01',
  syntax: 'NG_FIRS',
  providerId: 'firs',
  tax: vat(7.5),
});
