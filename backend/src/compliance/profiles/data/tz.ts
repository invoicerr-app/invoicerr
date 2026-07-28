/**
 * Tanzania (TZ) — Sub-Saharan Africa.
 * VFD
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const TZ: CountryComplianceProfile = realTime('TZ', 'Tanzania', {
  syntax: 'TZ_VFD',
  providerId: 'tz-tra',
  tax: vat(18),
});
