/**
 * Zambia (ZM) — Sub-Saharan Africa.
 * Smart Invoice
 */
import { realTime, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const ZM: CountryComplianceProfile = realTime('ZM', 'Zambia', {
  syntax: 'ZM_SMARTINVOICE',
  providerId: 'zm-zra',
  tax: vat(16),
});
