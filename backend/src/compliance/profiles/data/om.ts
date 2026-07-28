/**
 * Oman (OM) — Middle East & North Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const OM: CountryComplianceProfile = planned('OM', 'Oman', { tax: vat(5) });
