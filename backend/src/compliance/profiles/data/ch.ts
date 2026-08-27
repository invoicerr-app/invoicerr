/**
 * Switzerland (CH) — Europe.
 * no e-invoicing mandate (QR-bill domestic)
 */
import { noMandate, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CH: CountryComplianceProfile = noMandate('CH', 'Switzerland', { tax: vat(8.1, [3.8, 2.6]) });
