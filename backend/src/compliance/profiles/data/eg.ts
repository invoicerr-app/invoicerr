/**
 * Egypt (EG) — Middle East & North Africa.
 * ETA e-invoice + e-receipt
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const EG: CountryComplianceProfile = clearance('EG', 'Egypt', {
  from: '2020-11-01',
  syntax: 'EG_ETA',
  providerId: 'eg-eta',
  tax: vat(14),
});
