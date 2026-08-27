/**
 * Venezuela (VE) — Latin America.
 * SENIAT
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const VE: CountryComplianceProfile = clearance('VE', 'Venezuela', {
  syntax: 'VE_FE',
  providerId: 'seniat',
  tax: vat(16, [8]),
});
