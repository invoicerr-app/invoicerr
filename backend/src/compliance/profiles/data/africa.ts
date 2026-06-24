import { CountryComplianceProfile } from '../schema';
import { clearance, noMandate, periodic, planned, realTime, vat } from '../archetypes';

/** Sub-Saharan Africa. Many use real-time fiscal-device reporting; a few are still planned. */
export const AFRICA_PROFILES: CountryComplianceProfile[] = [
  clearance('NG', 'Nigeria', { from: '2024-01-01', syntax: 'NG_FIRS', providerId: 'firs', tax: vat(7.5) }), // FIRS e-invoicing
  realTime('KE', 'Kenya', { from: '2022-01-01', syntax: 'KE_ETIMS', providerId: 'ke-kra', tax: vat(16) }), // eTIMS
  realTime('GH', 'Ghana', { syntax: 'GH_EVAT', providerId: 'gh-gra', tax: vat(15) }), // GRA E-VAT
  realTime('RW', 'Rwanda', { syntax: 'RW_EBM', providerId: 'rw-rra', tax: vat(18) }), // EBM
  realTime('TZ', 'Tanzania', { syntax: 'TZ_VFD', providerId: 'tz-tra', tax: vat(18) }), // VFD
  realTime('UG', 'Uganda', { syntax: 'UG_EFRIS', providerId: 'ug-ura', tax: vat(18) }), // EFRIS
  realTime('ZM', 'Zambia', { syntax: 'ZM_SMARTINVOICE', providerId: 'zm-zra', tax: vat(16) }), // Smart Invoice
  realTime('ZW', 'Zimbabwe', { syntax: 'ZW_FDMS', providerId: 'zw-zimra', tax: vat(15) }), // FDMS
  realTime('CI', 'Ivory Coast', { syntax: 'CI_FNE', providerId: 'ci-dgi', tax: vat(18) }), // FNE / SIGF
  realTime('BJ', 'Benin', { syntax: 'BJ_MECEF', providerId: 'bj-dgi', tax: vat(18) }), // e-MECeF
  periodic('AO', 'Angola', { tax: vat(14) }), // SAF-T AO
  periodic('MZ', 'Mozambique', { tax: vat(16) }),
  noMandate('ZA', 'South Africa', { tax: vat(15) }),
  planned('CM', 'Cameroon', { tax: vat(19.25) }),
  planned('SN', 'Senegal', { tax: vat(18) }),
  planned('ET', 'Ethiopia', { tax: vat(15) }),
];
