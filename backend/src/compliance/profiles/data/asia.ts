import { CountryComplianceProfile } from '../schema';
import { clearance, planned, realTime, vat } from '../archetypes';

/** Asia / South Asia. Mix of national clearance and real-time reporting. */
export const ASIA_PROFILES: CountryComplianceProfile[] = [
  clearance('ID', 'Indonesia', { syntax: 'ID_EFAKTUR', providerId: 'id-coretax', tax: vat(11) }), // e-Faktur / Coretax
  clearance('TW', 'Taiwan', { syntax: 'TW_EGUI', providerId: 'tw-mof', tax: vat(5) }), // eGUI / unified invoice
  clearance('KZ', 'Kazakhstan', { syntax: 'KZ_ESF', providerId: 'kz-isesf', tax: vat(12) }), // IS ESF
  realTime('PH', 'Philippines', { syntax: 'PH_EIS', providerId: 'ph-bir', tax: vat(12) }), // BIR EIS
  realTime('TH', 'Thailand', { syntax: 'TH_ETAX', providerId: 'th-rd', tax: vat(7) }), // eTax Invoice & e-Receipt
  realTime('NP', 'Nepal', { syntax: 'NP_CBMS', providerId: 'np-ird', tax: vat(13) }), // IRD CBMS
  realTime('BD', 'Bangladesh', { syntax: 'BD_NBR', providerId: 'bd-nbr', tax: vat(15) }), // NBR
  realTime('PK', 'Pakistan', { syntax: 'PK_FBR', providerId: 'pk-fbr', tax: vat(18) }), // FBR XIR
  planned('LK', 'Sri Lanka', { tax: vat(18) }),
];
