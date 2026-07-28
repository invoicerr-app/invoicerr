/**
 * Dominican Republic (DO) — Latin America.
 * e-CF
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const DO: CountryComplianceProfile = clearance('DO', 'Dominican Republic', {
  syntax: 'DO_ECF',
  providerId: 'dgii',
  tax: vat(18, [16]),
});
