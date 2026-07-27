/**
 * Japan (JP) — Asia-Pacific.
 * qualified invoice; Peppol JP PINT (consumption tax)
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const JP: CountryComplianceProfile = postAudit('JP', 'Japan', { tax: vat(10, [8]) });
