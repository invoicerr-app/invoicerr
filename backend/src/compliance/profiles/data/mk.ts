/**
 * North Macedonia (MK) — Europe.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const MK: CountryComplianceProfile = planned('MK', 'North Macedonia', { tax: vat(18, [5]) });
