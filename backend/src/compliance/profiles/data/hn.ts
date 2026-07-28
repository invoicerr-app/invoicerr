/**
 * Honduras (HN) — Latin America.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const HN: CountryComplianceProfile = planned('HN', 'Honduras', { tax: vat(15, [18]) });
