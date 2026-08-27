/**
 * Australia (AU) — North America & Oceania.
 * Peppol / PINT A-NZ, voluntary
 */
import { gst, postAudit } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const AU: CountryComplianceProfile = postAudit('AU', 'Australia', { tax: gst(10) });
