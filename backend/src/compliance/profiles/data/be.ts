/**
 * Belgium (BE) — Europe.
 * B2B mandate Jan 2026 (Peppol)
 */
import { peppolCtc, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BE: CountryComplianceProfile = peppolCtc('BE', 'Belgium', {
  ctcFrom: '2026-01-01',
  tax: vat(21, [12, 6]),
});
