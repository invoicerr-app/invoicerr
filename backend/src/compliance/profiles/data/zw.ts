/**
 * Zimbabwe (ZW) — Sub-Saharan Africa.
 * FDMS
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const ZW: CountryComplianceProfile = realTime('ZW', 'Zimbabwe', {
  syntax: 'ZW_FDMS',
  providerId: 'zw-zimra',
  tax: vat(15),
});
