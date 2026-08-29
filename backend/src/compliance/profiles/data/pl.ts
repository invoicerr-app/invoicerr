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
    {
      validFrom: '1900-01-01',
      validTo: '2026-02-01',
      value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true },
    },
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

  // `hasDomesticZeroRate` makes explicit what `reducedRates` already asserted by listing 0 among
  // Poland's rates — this adds no new legal claim, it names one the data was carrying implicitly.
  // `data-integrity.spec.ts` now binds the two so they cannot drift apart.
  taxSystem: {
    kind: 'VAT',
    standardRate: 23,
    reducedRates: [8, 5, 0],
    hasDomesticZeroRate: true,
    schemes: ['STANDARD'],
  },

  lifecycle: [
    // Pre-KSeF: standard post-audit lifecycle — immutable after issue, credit-note corrections.
    {
      validFrom: '1900-01-01',
      validTo: '2026-02-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        correctionRoutes: [
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'UNVERIFIED',
            appliesTo: 'Régime pré-KSeF',
            // P3-T01 researched the KSeF era. Art. 106j predates it, so `CREDIT_NOTE` above is very
            // likely wrong too — but "likely wrong" is not a finding. An UNVERIFIED route keeps the
            // shipped behaviour untouched (the derivation falls back) while the doubt stays visible.
            openQuestion:
              "Le régime pré-KSeF n'a pas été recherché. Une interpretacja ogólna ou un arrêt NSA sur les factures « nie wprowadzone do obrotu prawnego » le trancherait.",
          },
        ],
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
    // KSeF era: immutable after clearance; only corrective invoices (faktura korygująca); no self-cancel.
    {
      validFrom: '2026-02-01',
      value: {
        immutableAfter: 'CLEARANCE',
        correctionModel: 'CORRECTIVE_INVOICE', // faktura korygująca
        correctionRoutes: [
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'REQUIRED',
            appliesTo: "Les 5 cas de l'art. 106j ust. 1, dont « pomyłka w jakiejkolwiek pozycji faktury »",
            // "podatnik WYSTAWIA fakturę korygującą" — an obligation, not an option. Two form locks
            // travel with it: ust. 4 forces the structured form, ust. 2 pkt 2a forces the original's
            // KSeF number into the correction.
            legalRef: 'Art. 106j ust. 1, ust. 2 pkt 2a, ust. 4 ustawy o VAT',
          },
          {
            route: 'CREDIT_NOTE',
            status: 'FORBIDDEN',
            direction: 'DECREASE',
            // Forbidden AS A DISTINCT DOCUMENT, not in substance: art. 106j ust. 1 gives one
            // instrument for both directions, and FA(3)'s RodzajFaktury is a closed enumeration
            // {VAT, KOR, ZAL, ROZ, UPR, KOR_ZAL, KOR_ROZ} with no credit-note type in it.
            legalRef: 'Art. 106j ust. 1 ; broszura FA(3), Ministerstwo Finansów',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'FORBIDDEN',
            direction: 'INCREASE',
            // Exactly the inverse of Italy: one document for both ways, the article being
            // direction-neutral — "podstawa opodatkowania lub kwota podatku […] uległa zmianie".
            legalRef: 'Art. 106j ust. 1 pkt 1',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'REQUIRED',
            appliesTo: "NIP de l'acheteur erroné",
            // Executed THROUGH corrective invoices — "fakturę korygującą do zera i nową fakturę
            // pierwotną" — never through an annulment, which does not exist here at all.
            legalRef: 'Podręcznik KSeF 2.0 cz. II, § 1.6.4',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'FORBIDDEN',
            // The mirror image of France and Italy, which REQUIRE this very route. "Jedyną formą
            // poprawienia błędu […] jest wystawienie faktury korygującej w KSeF." One route, three
            // countries, two opposite statuses — the finding that made P3-T02 necessary.
            legalRef: 'Podręcznik KSeF 2.0 cz. II, § 1.6.2',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // "W KSeF nie jest możliwe anulowanie wystawionej faktury", corroborated by a verified
            // negative: "anulow" occurs zero times in the whole consolidated VAT act.
            legalRef: 'Podręcznik KSeF 2.0 cz. II, § 1.6.3 ; tekst jednolity Dz.U. 2025 poz. 775',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'OPEN',
            appliesTo: 'Après rejet du XML — le numéro P_2 est conservé',
            legalRef: 'Podręcznik KSeF 2.0 cz. II, § 1.6.7 et Przykład 5',
          },
          {
            route: 'BUYER_CORRECTION_NOTE',
            status: 'FORBIDDEN',
            appliesTo: "Supprimée au 2026-02-01 — l'acheteur polonais n'a plus aucun instrument",
            // Chain, each link read: Dz.U. 2023 poz. 1598 art. 1 pkt 15 "uchyla się art. 106k", its
            // date moved from 2024-07-01 to 2026-02-01 by Dz.U. 2024 poz. 852 art. 1 pkt 6 lit. a.
            legalRef: 'Dz.U. 2023 poz. 1598 art. 1 pkt 15 ; Dz.U. 2024 poz. 852 art. 1 pkt 6 lit. a',
          },
        ],
        cancellation: { allowed: false, requiresAuthorityAck: true },
      },
    },
  ],

  archival: [
    { validFrom: '1900-01-01', value: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'SIGNED' } },
  ],

  reporting: [],

  // Art. 106e ust. 1 pkt 2 ustawy o VAT: "kolejny numer nadany w ramach jednej lub więcej serii,
  // który w sposób jednoznaczny identyfikuje fakturę". KSeF enforces uniqueness on (NIP, P_2,
  // RodzajFaktury) only, and MF tolerates out-of-order transmission without a correction. (PL-D7)
  numbering: [{ validFrom: '1900-01-01', value: { model: 'UNIQUE_SELF', seriesScope: 'ENTITY' } }],

  requiredIdentifiers: [
    {
      scheme: 'LEGAL_ID',
      label: 'REGON',
      appliesTo: 'COMPANY',
      required: false,
      pattern: '^\\d{9}(\\d{5})?$',
      helpText: '9-digit (or 14-digit for larger entities) statistical number',
    },
    {
      scheme: 'VAT',
      label: 'NIP',
      appliesTo: 'COMPANY',
      required: true,
      pattern: '^\\d{10}$',
      helpText: '10-digit tax identification number',
    },
  ],

  mandatoryReceiveSyntax: 'FA_VAT',
};
