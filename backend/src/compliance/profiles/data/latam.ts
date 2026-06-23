import { CountryComplianceProfile } from '../schema';
import { clearance, planned, vat } from '../archetypes';

/** Latin America (excluding the bespoke MX profile). Predominantly blocking clearance with folios. */
export const LATAM_PROFILES: CountryComplianceProfile[] = [
  clearance('AR', 'Argentina', { numbering: 'AUTHORITY_RANGE', tax: vat(21, [10.5, 27]) }), // CAE/CAEA
  clearance('BO', 'Bolivia', { tax: vat(13) }),
  clearance('BR', 'Brazil', { residency: 'BR', retentionYears: 11, tax: vat(17, [12, 7]) }), // NF-e family
  clearance('CL', 'Chile', { numbering: 'AUTHORITY_RANGE', tax: vat(19) }), // DTE + CAF
  clearance('CO', 'Colombia', { syntax: 'EN16931_UBL', residency: 'CO', tax: vat(19, [5]) }), // DIAN UBL
  clearance('CR', 'Costa Rica', { tax: vat(13, [4, 2, 1]) }),
  clearance('DO', 'Dominican Republic', { tax: vat(18, [16]) }), // e-CF
  clearance('EC', 'Ecuador', { tax: vat(15) }),
  clearance('GT', 'Guatemala', { tax: vat(12) }), // FEL
  planned('HN', 'Honduras', { tax: vat(15, [18]) }),
  planned('NI', 'Nicaragua', { tax: vat(15) }),
  clearance('PA', 'Panama', { tax: vat(7, [10, 15]) }),
  clearance('PE', 'Peru', { syntax: 'EN16931_UBL', channel: 'OSE', tax: vat(18) }), // UBL 2.1 via OSE
  clearance('PY', 'Paraguay', { tax: vat(10, [5]) }), // SIFEN
  clearance('SV', 'El Salvador', { tax: vat(13) }), // DTE
  clearance('UY', 'Uruguay', { tax: vat(22, [10]) }), // CFE
  clearance('VE', 'Venezuela', { tax: vat(16, [8]) }),
];
