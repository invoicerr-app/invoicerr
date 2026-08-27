import type { CountryComplianceProfile } from '../schema';

/**
 * France — see documentation/compliance/FR-France.md and COMPLIANCE_ARCHITECTURE.md §16.0.
 * Decentralized CTC (Y-model) via PDP + PPF annuaire from 2026-09-01; VAT with the
 * franchise-en-base (art. 293 B) scheme; gapless hash-chained numbering; e-invoicing
 * (domestic B2B) + e-reporting (B2C / cross-border) running together; mandatory statuses.
 */
export const FR: CountryComplianceProfile = {
  countryCode: 'FR',
  displayName: 'France',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [
    // Pre-reform: post-audit for everyone.
    {
      validFrom: '1900-01-01',
      validTo: '2026-09-01',
      value: { model: 'POST_AUDIT', blocking: false },
    },
    // From 2026-09-01: domestic B2B/B2G e-invoicing via the decentralized CTC network.
    {
      validFrom: '2026-09-01',
      value: {
        model: 'DECENTRALIZED_CTC',
        appliesTo: { roles: ['B2B', 'B2G'] },
        blocking: false,
      },
    },
    // From 2026-09-01: B2C handled by e-reporting (no domestic e-invoice to route).
    {
      validFrom: '2026-09-01',
      value: {
        model: 'REAL_TIME_REPORTING',
        appliesTo: { roles: ['B2C'] },
        blocking: false,
      },
    },
  ],

  formats: [
    {
      validFrom: '1900-01-01',
      value: {
        primary: { syntax: 'EN16931_CII' }, // CII XML → submitted to PDP (CTC post-processing applies)
        human: { syntax: 'FACTURX' }, // PDF/A-3 hybrid → delivered to buyers/humans
        buyerNegotiable: true,
      },
    },
  ],

  transmission: [
    {
      validFrom: '1900-01-01',
      validTo: '2026-09-01',
      value: { channels: [{ type: 'EMAIL' }] },
    },
    {
      validFrom: '2026-09-01',
      value: {
        // B2B (DECENTRALIZED_CTC): PDP is the mandatory channel.
        // B2G: Chorus Pro (GOV_PORTAL_API/choruspro) is mandatory for government buyers.
        // NOTE: TransmissionRule has no appliesTo; role-based selection (B2B→PDP,
        // B2G→choruspro) is future engine work. In practice, companies configure only the
        // channel relevant to their trade: B2B companies have PDP credentials (ChorusPro
        // is skipped for lack of credentials), B2G suppliers configure ChorusPro.
        // FR-D1: EMAIL removed from this period. From 2026-09-01 the emission, transmission and
        // reception of an in-scope invoice go through an accredited platform — "Seule une
        // plateforme agréée est habilitée à assurer toutes les fonctionnalités prévues"
        // (impots.gouv.fr, consulted 2026-08-27). Sending such an invoice by e-mail is not a
        // lesser channel, it is a sanctioned one: CGI art.1737 III, 50 EUR per invoice capped at
        // 15 000 EUR a year, and IV bis, 500 EUR then 1 000 EUR per quarter for persisting in not
        // using an accredited platform.
        //
        // The pre-2026-09-01 period above keeps EMAIL and is untouched — it was licit then.
        channels: [
          { type: 'PDP' },
          { type: 'GOV_PORTAL_API', providerId: 'choruspro' },
          { type: 'PEPPOL' },
        ],
      },
    },
  ],

  taxSystem: {
    kind: 'VAT',
    standardRate: 20,
    reducedRates: [10, 5.5, 2.1],
    schemes: ['STANDARD', 'FRANCHISE_BASE'],
  },

  lifecycle: [
    // Pre-reform: immutable after issue, credit-note corrections, no mandatory status set.
    {
      validFrom: '1900-01-01',
      validTo: '2026-09-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
    // From 2026-09-01: mandatory lifecycle statuses exchanged between platforms.
    {
      validFrom: '2026-09-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: false },
        response: {
          statuses: ['déposée', 'rejetée', 'refusée', 'encaissée'],
          defaultOnSilence: 'NONE',
        },
      },
    },
  ],

  archival: [
    {
      validFrom: '1900-01-01',
      value: {
        retentionYears: 10,
        archivedForm: 'BOTH',
        integrity: 'HASH_CHAIN',
      },
    },
  ],

  reporting: [
    // e-reporting for B2C from the mandate (cross-border B2B reporting is driven by tax flags).
    {
      validFrom: '2026-09-01',
      value: { kinds: ['E_REPORTING'], appliesTo: { roles: ['B2C'] } },
    },
  ],

  numbering: [
    {
      validFrom: '1900-01-01',
      value: { model: 'GAPLESS_SELF', hashChain: true, seriesScope: 'ENTITY' },
    },
  ],

  requiredIdentifiers: [
    {
      scheme: 'LEGAL_ID',
      label: 'SIRET',
      appliesTo: 'BOTH',
      required: true,
      pattern: '^\\d{14}$',
      helpText: '14 digits (SIRET)',
    },
    {
      scheme: 'VAT',
      label: 'N° TVA intracommunautaire',
      appliesTo: 'COMPANY',
      required: false,
    },
  ],

  mandatoryReceiveSyntax: 'FACTURX',
};
