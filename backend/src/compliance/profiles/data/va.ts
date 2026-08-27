/**
 * Vatican City (VA) — Europe.
 */
import { noMandate, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const VA: CountryComplianceProfile = noMandate('VA', 'Vatican City', { tax: vat(0) });
