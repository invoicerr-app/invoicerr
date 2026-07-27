/**
 * Vietnam (VN) — Asia-Pacific.
 * GDT clearance
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const VN: CountryComplianceProfile = clearance('VN', 'Vietnam', {
  syntax: 'VN_TT78',
  providerId: 'vn-gdt',
  tax: vat(10, [8, 5]),
});
