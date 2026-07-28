/**
 * Thailand (TH) — Asia-Pacific.
 * eTax Invoice & e-Receipt
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const TH: CountryComplianceProfile = realTime('TH', 'Thailand', {
  syntax: 'TH_ETAX',
  providerId: 'th-rd',
  tax: vat(7),
});
