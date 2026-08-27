/**
 * Sweden (SE) — Europe.
 * Peppol/SFTI, B2G mandatory
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SE: CountryComplianceProfile = postAudit('SE', 'Sweden', { tax: vat(25, [12, 6]) });
