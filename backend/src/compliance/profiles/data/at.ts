/**
 * Austria (AT) — Europe.
 * B2G mandatory, B2B voluntary
 */
import { postAudit, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const AT: CountryComplianceProfile = postAudit('AT', 'Austria', { tax: vat(20, [13, 10]) });
