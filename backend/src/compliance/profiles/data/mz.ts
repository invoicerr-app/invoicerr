/**
 * Mozambique (MZ) — Sub-Saharan Africa.
 */
import { periodic, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const MZ: CountryComplianceProfile = periodic('MZ', 'Mozambique', { tax: vat(16) });
