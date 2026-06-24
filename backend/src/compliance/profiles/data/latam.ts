import { CountryComplianceProfile } from '../schema';
import { clearance, planned, vat } from '../archetypes';

/**
 * Latin America (excluding the bespoke MX profile). Predominantly blocking clearance with folios.
 * Each country now points at its dedicated national format (`syntax`) + authority transmission
 * provider (`providerId`); see providers/format/national-formats.ts and
 * providers/transmission/national-portals.ts. Colombia/Peru use EN 16931 UBL, so no national format.
 */
export const LATAM_PROFILES: CountryComplianceProfile[] = [
  clearance('AR', 'Argentina', { syntax: 'AR_FE', providerId: 'afip', numbering: 'AUTHORITY_RANGE', tax: vat(21, [10.5, 27]) }), // ARCA/AFIP, CAE/CAEA
  clearance('BO', 'Bolivia', { syntax: 'BO_FE', providerId: 'bo-sin', tax: vat(13) }), // SIN, CUF
  clearance('BR', 'Brazil', { syntax: 'NFE', providerId: 'sefaz', residency: 'BR', retentionYears: 11, tax: vat(17, [12, 7]) }), // NF-e family, SEFAZ
  clearance('CL', 'Chile', {
    syntax: 'CL_DTE',
    providerId: 'sii',
    numbering: 'AUTHORITY_RANGE',
    tax: vat(19),
    // Ley 19.983: buyer has 8 days to accept/reject; silence = acceptance (CL-Chile.md).
    response: { window: { hours: 192 }, defaultOnSilence: 'ACCEPT', statuses: ['acuse de recibo', 'rechazo', 'reclamo'] },
  }), // DTE + CAF, SII
  clearance('CO', 'Colombia', { syntax: 'EN16931_UBL', providerId: 'dian', residency: 'CO', tax: vat(19, [5]) }), // DIAN UBL
  clearance('CR', 'Costa Rica', { syntax: 'CR_FE', providerId: 'cr-hacienda', tax: vat(13, [4, 2, 1]) }), // Hacienda v4.4
  clearance('DO', 'Dominican Republic', { syntax: 'DO_ECF', providerId: 'dgii', tax: vat(18, [16]) }), // e-CF
  clearance('EC', 'Ecuador', { syntax: 'EC_FE', providerId: 'sri', tax: vat(15) }), // SRI
  clearance('GT', 'Guatemala', { syntax: 'GT_FEL', providerId: 'gt-sat', tax: vat(12) }), // FEL
  planned('HN', 'Honduras', { tax: vat(15, [18]) }),
  planned('NI', 'Nicaragua', { tax: vat(15) }),
  clearance('PA', 'Panama', { syntax: 'PA_FE', providerId: 'pa-dgi', tax: vat(7, [10, 15]) }), // FE/CF
  clearance('PE', 'Peru', { syntax: 'EN16931_UBL', channel: 'OSE', tax: vat(18) }), // UBL 2.1 via OSE (SUNAT/SEE)
  clearance('PY', 'Paraguay', { syntax: 'PY_DE', providerId: 'sifen', tax: vat(10, [5]) }), // e-Kuatia / SIFEN
  clearance('SV', 'El Salvador', { syntax: 'SV_DTE', providerId: 'sv-mh', tax: vat(13) }), // DTE JSON, MH
  clearance('UY', 'Uruguay', { syntax: 'UY_CFE', providerId: 'uy-dgi', tax: vat(22, [10]) }), // CFE/DFE
  clearance('VE', 'Venezuela', { syntax: 'VE_FE', providerId: 'seniat', tax: vat(16, [8]) }), // SENIAT
];
