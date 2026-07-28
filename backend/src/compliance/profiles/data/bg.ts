/**
 * Bulgaria (BG) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BG: CountryComplianceProfile = postAudit('BG', 'Bulgaria', { tax: vat(20, [9]) });
