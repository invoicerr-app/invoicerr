/**
 * Estonia (EE) — Europe.
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const EE: CountryComplianceProfile = postAudit('EE', 'Estonia', { tax: vat(22) });
