/**
 * Luxembourg (LU) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const LU: CountryComplianceProfile = postAudit('LU', 'Luxembourg', { tax: vat(17, [14, 8, 3]) });
