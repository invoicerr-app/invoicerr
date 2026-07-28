/**
 * New Zealand (NZ) — North America & Oceania.
 * Peppol / PINT A-NZ, voluntary
 */
import { gst, postAudit } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const NZ: CountryComplianceProfile = postAudit('NZ', 'New Zealand', { tax: gst(15) });
