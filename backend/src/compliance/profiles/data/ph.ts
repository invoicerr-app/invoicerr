/**
 * Philippines (PH) — Asia-Pacific.
 * BIR EIS
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const PH: CountryComplianceProfile = realTime('PH', 'Philippines', {
  syntax: 'PH_EIS',
  providerId: 'ph-bir',
  tax: vat(12),
});
