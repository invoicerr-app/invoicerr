/**
 * El Salvador (SV) — Latin America.
 * DTE JSON, MH
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SV: CountryComplianceProfile = clearance('SV', 'El Salvador', {
  syntax: 'SV_DTE',
  providerId: 'sv-mh',
  tax: vat(13),
});
