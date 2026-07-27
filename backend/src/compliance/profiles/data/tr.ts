/**
 * Turkey (TR) — Middle East & North Africa.
 * GİB e-Fatura / e-Arşiv
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const TR: CountryComplianceProfile = clearance('TR', 'Turkey', {
  syntax: 'TR_EFATURA',
  providerId: 'gib',
  tax: vat(20, [10, 1]),
});
