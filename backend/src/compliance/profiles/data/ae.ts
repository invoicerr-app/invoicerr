/**
 * United Arab Emirates (AE) — Middle East & North Africa.
 * 5-corner accredited SPs
 */
import { peppolCtc, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const AE: CountryComplianceProfile = peppolCtc('AE', 'United Arab Emirates', {
  ctcFrom: '2026-07-01',
  tax: vat(5),
});
