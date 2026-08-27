/**
 * Uruguay (UY) — Latin America.
 * CFE/DFE
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const UY: CountryComplianceProfile = clearance('UY', 'Uruguay', {
  syntax: 'UY_CFE',
  providerId: 'uy-dgi',
  tax: vat(22, [10]),
});
