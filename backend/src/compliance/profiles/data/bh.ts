/**
 * Bahrain (BH) — Middle East & North Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BH: CountryComplianceProfile = planned('BH', 'Bahrain', { tax: vat(10) });
