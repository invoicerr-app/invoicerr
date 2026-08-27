/**
 * China (CN) — Asia-Pacific.
 * fully digitalized e-fapiao
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CN: CountryComplianceProfile = clearance('CN', 'China', {
  syntax: 'CN_EFAPIAO',
  providerId: 'cn-sta',
  tax: vat(13, [9, 6]),
});
