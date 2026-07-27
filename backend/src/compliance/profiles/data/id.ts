/**
 * Indonesia (ID) — Asia-Pacific.
 * e-Faktur / Coretax
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const ID: CountryComplianceProfile = clearance('ID', 'Indonesia', {
  syntax: 'ID_EFAKTUR',
  providerId: 'id-coretax',
  tax: vat(11),
});
