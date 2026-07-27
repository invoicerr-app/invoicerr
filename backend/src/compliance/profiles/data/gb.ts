/**
 * United Kingdom (GB) — Europe.
 */
import { noMandate, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const GB: CountryComplianceProfile = noMandate('GB', 'United Kingdom', { tax: vat(20, [5]) });
