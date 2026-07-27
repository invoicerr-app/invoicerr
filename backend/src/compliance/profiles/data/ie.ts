/**
 * Ireland (IE) — Europe.
 */
import { peppolCtc, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const IE: CountryComplianceProfile = peppolCtc('IE', 'Ireland', {
  ctcFrom: '2028-11-01',
  tax: vat(23, [13.5, 9, 4.8]),
});
