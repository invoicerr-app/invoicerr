/**
 * Slovakia (SK) — Europe.
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SK: CountryComplianceProfile = realTime('SK', 'Slovakia', {
  from: '2027-01-01',
  syntax: 'EN16931_UBL',
  providerId: 'sk-financnasprava',
  tax: vat(23, [19, 5]),
});
