/**
 * Croatia (HR) — Europe.
 * Fiscalization 2.0 / e-Račun
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const HR: CountryComplianceProfile = clearance('HR', 'Croatia', {
  from: '2026-01-01',
  syntax: 'HR_ERACUN',
  providerId: 'hr-fiskalizacija',
  tax: vat(25, [13, 5]),
});
