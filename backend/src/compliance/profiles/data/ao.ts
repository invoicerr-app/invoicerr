/**
 * Angola (AO) — Sub-Saharan Africa.
 * SAF-T AO
 */
import { periodic, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const AO: CountryComplianceProfile = periodic('AO', 'Angola', { tax: vat(14) });
