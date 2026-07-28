/**
 * Peru (PE) — Latin America.
 * UBL 2.1 via OSE (SUNAT/SEE)
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const PE: CountryComplianceProfile = clearance('PE', 'Peru', {
  syntax: 'EN16931_UBL',
  channel: 'OSE',
  tax: vat(18),
});
