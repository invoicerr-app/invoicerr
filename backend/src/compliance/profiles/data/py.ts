/**
 * Paraguay (PY) — Latin America.
 * e-Kuatia / SIFEN
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const PY: CountryComplianceProfile = clearance('PY', 'Paraguay', {
  syntax: 'PY_DE',
  providerId: 'sifen',
  tax: vat(10, [5]),
});
