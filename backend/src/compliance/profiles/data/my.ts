/**
 * Malaysia (MY) — Asia-Pacific.
 * MyInvois UBL (SST — placeholder rate)
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const MY: CountryComplianceProfile = clearance('MY', 'Malaysia', {
  from: '2024-08-01',
  syntax: 'EN16931_UBL',
  providerId: 'myinvois',
  tax: vat(8),
});
