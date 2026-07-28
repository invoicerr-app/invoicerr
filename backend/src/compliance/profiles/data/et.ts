/**
 * Ethiopia (ET) — Sub-Saharan Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const ET: CountryComplianceProfile = planned('ET', 'Ethiopia', { tax: vat(15) });
