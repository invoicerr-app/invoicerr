import { CountryComplianceProfile } from '../schema';
import { clearance, planned, vat } from '../archetypes';

/**
 * Latin America (excluding the bespoke MX profile). Predominantly blocking clearance with folios.
 * Each country now points at its dedicated national format (`syntax`) + authority transmission
 * provider (`providerId`); see providers/format/national-formats.ts and
 * providers/transmission/national-portals.ts. Colombia/Peru use EN 16931 UBL, so no national format.
 */
export const LATAM_PROFILES: CountryComplianceProfile[] = [
  clearance('AR', 'Argentina', {
    // F-9: requalified from AUTHORITY_RANGE — AFIP does not pre-allocate a folio range; the issuer
    // self-numbers sequentially (queries FECompUltimoAutorizado for the last authorized number and
    // increments) and only receives the CAE (Código de Autorización Electrónico) authorization
    // a posteriori, at transmit time (see afip-transmission.ts). That CAE is modeled as an
    // authorityId on the transmission result, independent of numbering — only the numbering model
    // was wrong. GAPLESS_SELF is the `clearance()` archetype default, so no override is needed here.
    syntax: 'AR_FE',
    providerId: 'afip',
    tax: vat(21, [10.5, 27]),
  }), // ARCA/AFIP, CAE a posteriori
  clearance('BO', 'Bolivia', { syntax: 'BO_FE', providerId: 'bo-sin', tax: vat(13) }), // SIN, CUF
  clearance('BR', 'Brazil', {
    syntax: 'NFE',
    providerId: 'sefaz',
    residency: 'BR',
    retentionYears: 11,
    tax: vat(17, [12, 7]),
  }), // NF-e family, SEFAZ
  clearance('CL', 'Chile', {
    // AUTHORITY_RANGE is correct here (unlike the AR case above, F-9): SII genuinely pre-allocates a
    // folio range via a CAF (Código de Autorización de Folios) file the issuer requests in advance
    // and then consumes offline, in order — a real range allocation, not a post-hoc authorization.
    syntax: 'CL_DTE',
    providerId: 'sii',
    numbering: 'AUTHORITY_RANGE',
    tax: vat(19),
    // Ley 19.983: buyer has 8 days to accept/reject; silence = acceptance (CL-Chile.md).
    response: {
      window: { hours: 192 },
      defaultOnSilence: 'ACCEPT',
      statuses: ['acuse de recibo', 'rechazo', 'reclamo'],
    },
  }), // DTE + CAF, SII
  clearance('CO', 'Colombia', {
    syntax: 'EN16931_UBL',
    providerId: 'dian',
    residency: 'CO',
    tax: vat(19, [5]),
  }), // DIAN UBL
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
