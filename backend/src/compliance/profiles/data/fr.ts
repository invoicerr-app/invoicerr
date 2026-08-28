import type { CountryComplianceProfile } from '../schema';

/**
 * ⚠️ THE LEGAL BASIS CITED THROUGHOUT THIS FILE EXPIRES ON 2027-01-01.
 *
 * CGI arts. 289 bis and 290 are both "Abrogé par Ordonnance n° 2025-1247 du 17 décembre 2025 -
 * art. 9", repealed as of 2027-01-01 and maintained in force only until taken over by the code des
 * impositions sur les biens et services — L. 215-39 and L. 216-44 for e-invoicing, L. 215-39 /
 * L. 216-55 / L. 216-56 for e-reporting. (Légifrance, consulted 2026-08-28.)
 *
 * The mandate starts 2026-09-01 on the CGI and its basis moves four months later. Every `CGI art.
 * 289 bis` citation in this repository — eight files carry one — therefore has a known expiry date,
 * and this note is the only place that says so.
 *
 * OPEN, and deliberately not assumed: whether the recodification is at constant law ON THE TRIGGER
 * itself. The CIBS articles have not been read. Nothing here is coded on a supposed equivalence;
 * the model follows the CGI text, which is in force until at least 2027-01-01. See
 * docs/compliance/FR-RATTACHEMENT.md §4.
 *
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
    // P2-T02 — TWO attachment predicates, not one, and P2-V01 established why (Légifrance,
    // consulted 2026-08-28; see docs/compliance/FR-RATTACHEMENT.md):
    //
    //   art. 289 bis I  applies "lorsque l'émetteur de la facture ET son destinataire sont des
    //                   assujettis qui sont établis ou ont leur domicile ou leur résidence
    //                   habituelle en France" — a BILATERAL attachment test.
    //   art. 289 bis V  "Le présent article ne s'applique pas aux opérations mentionnées […] au 1°
    //                   du I de l'article 262 ter" — intra-Community exempt supplies, excluded
    //                   WHATEVER the parties' attachment.
    //
    // The two are independent: a rule carrying only the bilateral test gives FR→IT the right answer
    // by accident, and the wrong one for an intra-EU supply between two French-attached parties.
    {
      validFrom: '2026-09-01',
      value: {
        model: 'DECENTRALIZED_CTC',
        appliesTo: { roles: ['B2B', 'B2G'] },
        attachment: [
          { kind: 'BOTH_ATTACHED_TO', country: 'FR' },
          { kind: 'NOT_OF_NATURE', nature: 'intraCommunitySupply' },
        ],
        blocking: false,
      },
    },
    // B2B/B2G operations that are NOT domestic fall under e-reporting, not e-invoicing — CGI
    // art. 290 I 1°: a) supplies exempt under arts. 262 and 262 ter, c) services not situated in
    // France under arts. 259/259 A. This is the rule the engine was missing: those operations
    // resolved to DECENTRALIZED_CTC and were routed to a PDP.
    //
    // Known gap rather than an oversight: art. 290 I is WIDER than "cross-border" — it also covers
    // domestic supplies to a taxable person not established in France (1° b), B2C supplies situated
    // in France (2° b, f) and acquisitions (3°). Only the complement of the bilateral test is
    // encoded here; the rest is its own task.
    {
      validFrom: '2026-09-01',
      value: {
        model: 'REAL_TIME_REPORTING',
        appliesTo: { roles: ['B2B', 'B2G'] },
        attachment: [{ kind: 'NOT_BOTH_ATTACHED_TO', country: 'FR' }],
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
        // P2-T02: the same bilateral test gates the CHANNELS. A regime alone is not enough — the
        // channel is what actually routes the document, and offering a PDP for an operation outside
        // the e-invoicing mandate is precisely the defect being fixed.
        // NOT filtered by role, deliberately, and this is a modelling limit rather than an
        // oversight. A domestic B2C sale is outside the e-invoicing mandate (art. 289 bis I covers
        // the operations of art. 289 I 1 a and d — B2B and B2G), so it should not be ROUTED through
        // a PDP. But art. 290 III requires the e-reporting DATA to reach the administration through
        // the accredited platform, and today `channels` is a single list serving both purposes —
        // filtering B2C out here would also cut the data path, and the lifecycle statuses with it.
        //
        // Separating "where the invoice goes" from "where the data goes" is exactly what A2's
        // obligation model is for. Until then B2C keeps today's channels, unchanged.
        attachment: [
          { kind: 'BOTH_ATTACHED_TO', country: 'FR' },
          { kind: 'NOT_OF_NATURE', nature: 'intraCommunitySupply' },
        ],
        channels: [
          { type: 'PDP' },
          { type: 'GOV_PORTAL_API', providerId: 'choruspro' },
          { type: 'PEPPOL' },
        ],
      },
    },
    // Operations outside the e-invoicing mandate keep an ordinary delivery channel: the e-reporting
    // DATA reaches the administration through the platform, but the INVOICE itself is not routed
    // through the CTC network.
    {
      validFrom: '2026-09-01',
      value: {
        attachment: [{ kind: 'NOT_BOTH_ATTACHED_TO', country: 'FR' }],
        channels: [{ type: 'EMAIL' }],
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
