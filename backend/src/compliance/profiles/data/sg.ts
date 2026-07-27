/**
 * Singapore (SG) — Asia-Pacific.
 * InvoiceNow (Peppol 5-corner)
 */
import { gst, peppolCtc } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SG: CountryComplianceProfile = peppolCtc('SG', 'Singapore', {
  ctcFrom: '2025-11-01',
  tax: gst(9),
});
