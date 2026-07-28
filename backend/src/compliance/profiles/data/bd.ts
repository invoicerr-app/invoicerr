/**
 * Bangladesh (BD) — Asia-Pacific.
 * NBR
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BD: CountryComplianceProfile = realTime('BD', 'Bangladesh', {
  syntax: 'BD_NBR',
  providerId: 'bd-nbr',
  tax: vat(15),
});
