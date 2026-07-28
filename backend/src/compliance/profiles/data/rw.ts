/**
 * Rwanda (RW) — Sub-Saharan Africa.
 * EBM
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const RW: CountryComplianceProfile = realTime('RW', 'Rwanda', {
  syntax: 'RW_EBM',
  providerId: 'rw-rra',
  tax: vat(18),
});
