/**
 * Albania (AL) — Europe.
 * CIS fiscalization
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const AL: CountryComplianceProfile = clearance('AL', 'Albania', {
  from: '2021-01-01',
  syntax: 'AL_FISCALIZATION',
  providerId: 'al-cis',
  tax: vat(20),
});
