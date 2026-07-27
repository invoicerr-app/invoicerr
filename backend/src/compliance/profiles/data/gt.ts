/**
 * Guatemala (GT) — Latin America.
 * FEL
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const GT: CountryComplianceProfile = clearance('GT', 'Guatemala', {
  syntax: 'GT_FEL',
  providerId: 'gt-sat',
  tax: vat(12),
});
