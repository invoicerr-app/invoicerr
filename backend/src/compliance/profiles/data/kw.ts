/**
 * Kuwait (KW) — Middle East & North Africa.
 * no VAT yet
 */
import { noTax, planned } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const KW: CountryComplianceProfile = planned('KW', 'Kuwait', { tax: noTax() });
