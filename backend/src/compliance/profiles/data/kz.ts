/**
 * Kazakhstan (KZ) — Asia-Pacific.
 * IS ESF
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const KZ: CountryComplianceProfile = clearance('KZ', 'Kazakhstan', {
  syntax: 'KZ_ESF',
  providerId: 'kz-isesf',
  tax: vat(12),
});
