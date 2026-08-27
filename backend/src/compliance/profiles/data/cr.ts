/**
 * Costa Rica (CR) — Latin America.
 * Hacienda v4.4
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CR: CountryComplianceProfile = clearance('CR', 'Costa Rica', {
  syntax: 'CR_FE',
  providerId: 'cr-hacienda',
  tax: vat(13, [4, 2, 1]),
});
