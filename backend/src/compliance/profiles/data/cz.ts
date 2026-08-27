/**
 * Czechia (CZ) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CZ: CountryComplianceProfile = postAudit('CZ', 'Czechia', { tax: vat(21, [12]) });
