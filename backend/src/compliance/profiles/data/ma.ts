/**
 * Morocco (MA) — Middle East & North Africa.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const MA: CountryComplianceProfile = planned('MA', 'Morocco', { tax: vat(20, [14, 10, 7]) });
