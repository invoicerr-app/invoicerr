/**
 * Nicaragua (NI) — Latin America.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const NI: CountryComplianceProfile = planned('NI', 'Nicaragua', { tax: vat(15) });
