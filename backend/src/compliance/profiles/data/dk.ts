/**
 * Denmark (DK) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const DK: CountryComplianceProfile = postAudit('DK', 'Denmark', { tax: vat(25) });
