/**
 * Saudi Arabia (SA) — Middle East & North Africa.
 * ZATCA FATOORA
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SA: CountryComplianceProfile = clearance('SA', 'Saudi Arabia', {
  from: '2023-01-01',
  syntax: 'KSA_UBL',
  providerId: 'zatca',
  residency: 'SA',
  retentionYears: 6,
  tax: vat(15),
});
