/**
 * Sri Lanka (LK) — Asia-Pacific.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const LK: CountryComplianceProfile = planned('LK', 'Sri Lanka', { tax: vat(18) });
