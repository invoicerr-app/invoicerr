import { CountryComplianceProfile } from '../schema';

/**
 * Poland — KSeF (Krajowy System e-Faktur), national FA_VAT format. Demonstrates the providerId
 * mechanism: KSeF is a GOV_PORTAL_API system selected explicitly via ChannelSpec.providerId='ksef'
 * so it never collides with other national portals sharing the generic channel type. Mandatory B2B
 * clearance phases in from 2026.
 */
export const PL: CountryComplianceProfile = {
  countryCode: 'PL',
  displayName: 'Poland',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [
    { validFrom: '1900-01-01', validTo: '2026-02-01', value: { model: 'POST_AUDIT', blocking: false } },
    { validFrom: '2026-02-01', value: { model: 'CLEARANCE', blocking: true } },
  ],

  formats: [
    { validFrom: '1900-01-01', validTo: '2026-02-01', value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } },
    {
      validFrom: '2026-02-01',
      value: { primary: { syntax: 'FA_VAT' }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: false },
    },
  ],

  transmission: [
    { validFrom: '1900-01-01', validTo: '2026-02-01', value: { channels: [{ type: 'EMAIL' }] } },
    // KSeF selected by providerId, not just the generic GOV_PORTAL_API channel type.
    { validFrom: '2026-02-01', value: { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } },
  ],

  taxSystem: { kind: 'VAT', standardRate: 23, reducedRates: [8, 5, 0], schemes: ['STANDARD'] },

  lifecycle: [
    {
      validFrom: '2026-02-01',
      value: {
        immutableAfter: 'CLEARANCE',
        correctionModel: 'CORRECTIVE_INVOICE', // faktura korygująca
        cancellation: { allowed: false, requiresAuthorityAck: true },
      },
    },
  ],

  archival: [
    { validFrom: '1900-01-01', value: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'SIGNED' } },
  ],

  reporting: [],

  numbering: [{ validFrom: '1900-01-01', value: { model: 'GAPLESS_SELF', seriesScope: 'ENTITY' } }],

  mandatoryReceiveSyntax: 'FA_VAT',
};
