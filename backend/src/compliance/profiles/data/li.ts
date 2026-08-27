/**
 * Liechtenstein (LI) — Europe.
 * Swiss VAT system
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const LI: CountryComplianceProfile = postAudit('LI', 'Liechtenstein', { tax: vat(8.1, [3.8, 2.6]) });
