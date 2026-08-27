/**
 * Norway (NO) — Europe.
 * EEA; EHF/Peppol + SAF-T
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const NO: CountryComplianceProfile = postAudit('NO', 'Norway', { tax: vat(25, [15, 12]) });
