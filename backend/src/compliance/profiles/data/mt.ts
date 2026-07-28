/**
 * Malta (MT) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const MT: CountryComplianceProfile = postAudit('MT', 'Malta', { tax: vat(18, [7, 5]) });
