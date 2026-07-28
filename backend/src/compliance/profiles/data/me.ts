/**
 * Montenegro (ME) — Europe.
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const ME: CountryComplianceProfile = realTime('ME', 'Montenegro', {
  from: '2021-01-01',
  syntax: 'ME_FISCAL',
  providerId: 'me-fiscal',
  tax: vat(21, [7]),
});
