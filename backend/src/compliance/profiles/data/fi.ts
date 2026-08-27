/**
 * Finland (FI) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const FI: CountryComplianceProfile = postAudit('FI', 'Finland', { tax: vat(25.5, [14, 10]) });
