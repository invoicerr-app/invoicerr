import { CountryComplianceProfile } from '../schema';

/**
 * Italy — CLEARANCE via the Sistema di Interscambio (SdI), national FatturaPA format. Demonstrates a
 * country whose building blocks already exist as shared providers (SdI transmission + FatturaPA
 * format): adding it is essentially a profile + registry line. Cross-border (FR→IT…) works because IT
 * is already in the EU tax-union table.
 */
export const IT: CountryComplianceProfile = {
  countryCode: 'IT',
  displayName: 'Italy',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [
    { validFrom: '1900-01-01', validTo: '2019-01-01', value: { model: 'POST_AUDIT', blocking: false } },
    { validFrom: '2019-01-01', value: { model: 'CLEARANCE', blocking: true } },
  ],

  formats: [
    { validFrom: '1900-01-01', validTo: '2019-01-01', value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } },
    {
      validFrom: '2019-01-01',
      value: { primary: { syntax: 'FATTURAPA', version: '1.2' }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: false },
    },
  ],

  transmission: [
    { validFrom: '1900-01-01', validTo: '2019-01-01', value: { channels: [{ type: 'EMAIL' }] } },
    { validFrom: '2019-01-01', value: { channels: [{ type: 'SDI' }] } },
  ],

  taxSystem: { kind: 'VAT', standardRate: 22, reducedRates: [10, 5, 4], schemes: ['STANDARD'] },

  lifecycle: [
    {
      validFrom: '2019-01-01',
      value: {
        immutableAfter: 'CLEARANCE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: true },
      },
    },
  ],

  archival: [
    { validFrom: '1900-01-01', value: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'SIGNED' } },
  ],

  reporting: [],

  numbering: [{ validFrom: '1900-01-01', value: { model: 'GAPLESS_SELF', seriesScope: 'ENTITY' } }],

  requiredIdentifiers: [
    {
      scheme: 'LEGAL_ID',
      label: 'Codice Fiscale',
      appliesTo: 'INDIVIDUAL',
      required: true,
      pattern: '^[A-Z]{6}\\d{2}[A-Z]\\d{2}[A-Z]\\d{3}[A-Z]$',
      helpText: '16-character fiscal code',
    },
    {
      scheme: 'VAT',
      label: 'Partita IVA',
      appliesTo: 'COMPANY',
      required: true,
      pattern: '^\\d{11}$',
      helpText: '11-digit VAT number',
    },
  ],

  mandatoryReceiveSyntax: 'FATTURAPA',
};
