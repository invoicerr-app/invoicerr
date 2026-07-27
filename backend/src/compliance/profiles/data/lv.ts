/**
 * Latvia (LV) — Europe.
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const LV: CountryComplianceProfile = realTime('LV', 'Latvia', {
  from: '2026-01-01',
  syntax: 'EN16931_UBL',
  providerId: 'lv-vid',
  tax: vat(21, [12, 5]),
});
