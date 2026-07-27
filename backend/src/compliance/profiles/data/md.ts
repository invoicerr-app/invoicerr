/**
 * Moldova (MD) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const MD: CountryComplianceProfile = postAudit('MD', 'Moldova', { tax: vat(20, [8]) });
