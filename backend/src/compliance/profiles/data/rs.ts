/**
 * Serbia (RS) — Europe.
 * SEF (UBL/SRBEFN)
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const RS: CountryComplianceProfile = clearance('RS', 'Serbia', {
  syntax: 'EN16931_UBL',
  providerId: 'rs-sef',
  tax: vat(20, [10]),
});
