/**
 * Taiwan (TW) — Asia-Pacific.
 * eGUI / unified invoice
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const TW: CountryComplianceProfile = clearance('TW', 'Taiwan', {
  syntax: 'TW_EGUI',
  providerId: 'tw-mof',
  tax: vat(5),
});
