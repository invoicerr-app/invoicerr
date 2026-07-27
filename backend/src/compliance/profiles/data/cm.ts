/**
 * Cameroon (CM) — Sub-Saharan Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CM: CountryComplianceProfile = planned('CM', 'Cameroon', { tax: vat(19.25) });
