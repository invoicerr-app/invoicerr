/**
 * Bolivia (BO) — Latin America.
 * SIN, CUF
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BO: CountryComplianceProfile = clearance('BO', 'Bolivia', {
  syntax: 'BO_FE',
  providerId: 'bo-sin',
  tax: vat(13),
});
