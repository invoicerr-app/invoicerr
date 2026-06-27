import { CountryComplianceProfile } from '../schema';
import { gst, noMandate, postAudit } from '../archetypes';

/**
 * Other developed markets that don't fit a single regional bucket (North America & Oceania).
 * Peppol-voluntary or no e-invoicing mandate today. Added with the dev docs merge (78→106 specs).
 */
export const REST_PROFILES: CountryComplianceProfile[] = [
  noMandate('CA', 'Canada', { tax: gst(5) }), // GST/HST (federal 5% + provincial PST/QST); no e-invoicing mandate
  postAudit('AU', 'Australia', { tax: gst(10) }), // Peppol / PINT A-NZ, voluntary
  postAudit('NZ', 'New Zealand', { tax: gst(15) }), // Peppol / PINT A-NZ, voluntary
];
