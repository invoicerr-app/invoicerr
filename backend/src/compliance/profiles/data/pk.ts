/**
 * Pakistan (PK) — Asia-Pacific.
 * FBR XIR
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const PK: CountryComplianceProfile = realTime('PK', 'Pakistan', {
  syntax: 'PK_FBR',
  providerId: 'pk-fbr',
  tax: vat(18),
});
