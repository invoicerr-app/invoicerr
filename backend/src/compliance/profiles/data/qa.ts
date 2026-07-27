/**
 * Qatar (QA) — Middle East & North Africa.
 * no VAT yet
 */
import { noTax, planned } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const QA: CountryComplianceProfile = planned('QA', 'Qatar', { tax: noTax() });
