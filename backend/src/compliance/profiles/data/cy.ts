/**
 * Cyprus (CY) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CY: CountryComplianceProfile = postAudit('CY', 'Cyprus', { tax: vat(19, [9, 5]) });
