/**
 * San Marino (SM) — Europe.
 * monofase via SdI
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const SM: CountryComplianceProfile = clearance('SM', 'San Marino', {
  syntax: 'FATTURAPA',
  channel: 'SDI',
  tax: vat(0),
  signed: false,
});
