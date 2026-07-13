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
    {
      validFrom: '1900-01-01',
      validTo: '2019-01-01',
      value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true },
    },
    {
      validFrom: '2019-01-01',
      value: {
        primary: { syntax: 'FATTURAPA', version: '1.2' },
        human: { syntax: 'PLAIN_PDF' },
        buyerNegotiable: false,
      },
    },
  ],

  transmission: [
    { validFrom: '1900-01-01', validTo: '2019-01-01', value: { channels: [{ type: 'EMAIL' }] } },
    { validFrom: '2019-01-01', value: { channels: [{ type: 'SDI' }] } },
  ],

  taxSystem: { kind: 'VAT', standardRate: 22, reducedRates: [10, 5, 4], schemes: ['STANDARD'] },

  lifecycle: [
    // Pre-SdI: standard post-audit lifecycle — immutable after issue, credit-note corrections.
    {
      validFrom: '1900-01-01',
      validTo: '2019-01-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
    // SdI era: immutable after clearance; AdE acknowledgement required to cancel.
    // M-7: the buyer's notifica NE (esito EC01/EC02) is optional — 15 days (360h) of silence is
    // "decorrenza termini", legally deemed accepted (defaultOnSilence: 'ACCEPT').
    {
      validFrom: '2019-01-01',
      value: {
        immutableAfter: 'CLEARANCE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: true },
        response: {
          defaultOnSilence: 'ACCEPT',
          window: { hours: 360 },
          statuses: ['accettata', 'rifiutata'],
        },
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
    // F-16/M-8: optional alternatives that drive FatturaPA's CodiceDestinatario/PECDestinatario
    // routing (national/fattura-pa.ts) — neither is individually required since they're
    // alternatives to each other (and a foreign buyer needs neither); the builder's routing logic
    // enforces the real-world choice at render time.
    {
      scheme: 'IT_SDI',
      label: 'Codice Destinatario',
      appliesTo: 'COMPANY',
      required: false,
      pattern: '^[A-Za-z0-9]{7}$',
      helpText: '7-char SdI recipient code (or provide a PEC)',
    },
    {
      scheme: 'PEC',
      label: 'PEC',
      appliesTo: 'BOTH',
      required: false,
      helpText: 'Certified email — required for domestic delivery when no Codice Destinatario',
    },
  ],

  mandatoryReceiveSyntax: 'FATTURAPA',
};
