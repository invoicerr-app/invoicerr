import { CountryComplianceProfile } from '../schema';
import { clearance, noMandate, periodic, planned, realTime, vat } from '../archetypes';

/** Sub-Saharan Africa. Many use real-time fiscal-device reporting; a few are still planned. */
export const AFRICA_PROFILES: CountryComplianceProfile[] = [
  clearance('NG', 'Nigeria', { from: '2024-01-01', tax: vat(7.5) }), // FIRS e-invoicing
  realTime('KE', 'Kenya', { from: '2022-01-01', tax: vat(16) }), // eTIMS
  realTime('GH', 'Ghana', { tax: vat(15) }), // GRA E-VAT
  realTime('RW', 'Rwanda', { tax: vat(18) }), // EBM
  realTime('TZ', 'Tanzania', { tax: vat(18) }), // VFD
  realTime('UG', 'Uganda', { tax: vat(18) }), // EFRIS
  realTime('ZM', 'Zambia', { tax: vat(16) }), // Smart Invoice
  realTime('ZW', 'Zimbabwe', { tax: vat(15) }), // FDMS
  realTime('CI', 'Ivory Coast', { tax: vat(18) }), // FNE
  realTime('BJ', 'Benin', { tax: vat(18) }), // e-MECeF
  periodic('AO', 'Angola', { tax: vat(14) }), // SAF-T AO
  periodic('MZ', 'Mozambique', { tax: vat(16) }),
  noMandate('ZA', 'South Africa', { tax: vat(15) }),
  planned('CM', 'Cameroon', { tax: vat(19.25) }),
  planned('SN', 'Senegal', { tax: vat(18) }),
  planned('ET', 'Ethiopia', { tax: vat(15) }),
];
