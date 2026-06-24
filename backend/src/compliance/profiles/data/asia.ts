import { CountryComplianceProfile } from '../schema';
import { clearance, gst, peppolCtc, planned, postAudit, realTime, vat } from '../archetypes';

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

  // --- Majors added with the dev docs merge (catch-all format/channel until dedicated stubs) ---
  clearance('CN', 'China', { tax: vat(13, [9, 6]) }), // fully digitalized e-fapiao
  clearance('IN', 'India', { tax: gst(18, [28, 12, 5]) }), // IRN / IRP clearance + e-way
  clearance('VN', 'Vietnam', { tax: vat(10, [8, 5]) }), // GDT clearance
  clearance('MY', 'Malaysia', { from: '2024-08-01', tax: vat(8) }), // MyInvois (SST — placeholder rate)
  peppolCtc('SG', 'Singapore', { ctcFrom: '2025-11-01', tax: gst(9) }), // InvoiceNow (Peppol 5-corner)
  postAudit('JP', 'Japan', { tax: vat(10, [8]) }), // qualified invoice; Peppol JP PINT (consumption tax)
];
