/**
 * Slovenia (SI) — Europe.
 */
import { peppolCtc, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SI: CountryComplianceProfile = peppolCtc('SI', 'Slovenia', {
  ctcFrom: '2027-06-01',
  tax: vat(22, [9.5, 5]),
});
