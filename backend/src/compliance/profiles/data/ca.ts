/**
 * Canada (CA) — North America & Oceania.
 * GST/HST (federal 5% + provincial PST/QST); no e-invoicing mandate
 */
import { gst, noMandate } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CA: CountryComplianceProfile = noMandate('CA', 'Canada', { tax: gst(5) });
