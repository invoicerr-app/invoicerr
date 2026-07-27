/**
 * Brazil (BR) — Latin America.
 * NF-e family, SEFAZ
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BR: CountryComplianceProfile = clearance('BR', 'Brazil', {
  syntax: 'NFE',
  providerId: 'sefaz',
  residency: 'BR',
  retentionYears: 11,
  tax: vat(17, [12, 7]),
});
