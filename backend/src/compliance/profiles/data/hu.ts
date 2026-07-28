/**
 * Hungary (HU) — Europe.
 * NAV Online Számla (RTIR)
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const HU: CountryComplianceProfile = realTime('HU', 'Hungary', {
  from: '2018-07-01',
  syntax: 'NATIONAL_XML',
  providerId: 'hu-nav',
  tax: vat(27, [18, 5]),
});
