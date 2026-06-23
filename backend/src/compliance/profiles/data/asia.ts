import { CountryComplianceProfile } from '../schema';
import { clearance, planned, realTime, vat } from '../archetypes';

/** Asia / South Asia. Mix of national clearance and real-time reporting. */
export const ASIA_PROFILES: CountryComplianceProfile[] = [
  clearance('ID', 'Indonesia', { tax: vat(11) }), // e-Faktur / Coretax
  clearance('TW', 'Taiwan', { tax: vat(5) }), // eGUI / unified invoice
  clearance('KZ', 'Kazakhstan', { tax: vat(12) }), // IS ESF
  realTime('PH', 'Philippines', { tax: vat(12) }), // BIR EIS
  realTime('TH', 'Thailand', { tax: vat(7) }), // eTax Invoice & e-Receipt
  realTime('NP', 'Nepal', { tax: vat(13) }), // IRD CBMS
  realTime('BD', 'Bangladesh', { tax: vat(15) }),
  realTime('PK', 'Pakistan', { tax: vat(18) }), // FBR
  planned('LK', 'Sri Lanka', { tax: vat(18) }),
];
