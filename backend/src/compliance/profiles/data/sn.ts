/**
 * Senegal (SN) — Sub-Saharan Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SN: CountryComplianceProfile = planned('SN', 'Senegal', { tax: vat(18) });
