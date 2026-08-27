/**
 * Bosnia and Herzegovina (BA) — Europe.
 */
import { planned, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const BA: CountryComplianceProfile = planned('BA', 'Bosnia and Herzegovina', { tax: vat(17) });
