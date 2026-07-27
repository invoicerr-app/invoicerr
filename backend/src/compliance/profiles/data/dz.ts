/**
 * Algeria (DZ) — Middle East & North Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const DZ: CountryComplianceProfile = planned('DZ', 'Algeria', { tax: vat(19, [9]) });
