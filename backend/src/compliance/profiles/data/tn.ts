/**
 * Tunisia (TN) — Middle East & North Africa.
 * El Fatoura / TEIF via TTN
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const TN: CountryComplianceProfile = clearance('TN', 'Tunisia', {
  syntax: 'TN_TEIF',
  providerId: 'tn-ttn',
  tax: vat(19, [13, 7]),
});
