/**
 * South Africa (ZA) — Sub-Saharan Africa.
 */
import { noMandate, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const ZA: CountryComplianceProfile = noMandate('ZA', 'South Africa', { tax: vat(15) });
