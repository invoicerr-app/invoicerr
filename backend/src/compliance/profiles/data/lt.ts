/**
 * Lithuania (LT) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const LT: CountryComplianceProfile = postAudit('LT', 'Lithuania', { tax: vat(21, [9, 5]) });
