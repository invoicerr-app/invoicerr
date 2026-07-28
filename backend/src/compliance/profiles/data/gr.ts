/**
 * Greece (GR) — Europe.
 * AADE myDATA
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const GR: CountryComplianceProfile = realTime('GR', 'Greece', {
  from: '2021-01-01',
  syntax: 'NATIONAL_XML',
  providerId: 'gr-aade',
  tax: vat(24, [13, 6]),
});
