/**
 * Colombia (CO) — Latin America.
 * DIAN UBL
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CO: CountryComplianceProfile = clearance('CO', 'Colombia', {
  syntax: 'EN16931_UBL',
  providerId: 'dian',
  residency: 'CO',
  tax: vat(19, [5]),
});
