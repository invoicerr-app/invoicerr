/**
 * Netherlands (NL) — Europe.
 * Peppol, voluntary B2B
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const NL: CountryComplianceProfile = postAudit('NL', 'Netherlands', { tax: vat(21, [9]) });
