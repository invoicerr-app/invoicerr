/**
 * Panama (PA) — Latin America.
 * FE/CF
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const PA: CountryComplianceProfile = clearance('PA', 'Panama', {
  syntax: 'PA_FE',
  providerId: 'pa-dgi',
  tax: vat(7, [10, 15]),
});
