/**
 * Portugal (PT) — Europe.
 * SAF-T PT + ATCUD/QR ("smart invoice")
 */
import { periodic, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const PT: CountryComplianceProfile = periodic('PT', 'Portugal', { tax: vat(23, [13, 6]) });
