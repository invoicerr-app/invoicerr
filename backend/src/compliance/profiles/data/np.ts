/**
 * Nepal (NP) — Asia-Pacific.
 * IRD CBMS
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const NP: CountryComplianceProfile = realTime('NP', 'Nepal', {
  syntax: 'NP_CBMS',
  providerId: 'np-ird',
  tax: vat(13),
});
