/**
 * Jordan (JO) — Middle East & North Africa.
 * JoFotara
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const JO: CountryComplianceProfile = clearance('JO', 'Jordan', {
  syntax: 'JO_JOFOTARA',
  providerId: 'jofotara',
  tax: vat(16),
});
