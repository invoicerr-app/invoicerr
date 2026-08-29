import { CountryComplianceProfile } from '../schema';

/**
 * United States — the deliberate contrast to France (COMPLIANCE_ARCHITECTURE.md §15/§16.2-16.3).
 * No VAT at all: destination-based **sales/use tax** by state, collected only where the seller has
 * nexus. No federal e-invoicing mandate (post-audit); structured exchange (DBNAlliance/Peppol-US) is
 * voluntary. This exercises the SALES_TAX branch of the tax engine and a non-VAT origin in
 * cross-border composition.
 */
export const US: CountryComplianceProfile = {
  countryCode: 'US',
  displayName: 'United States',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [{ validFrom: '1900-01-01', value: { model: 'POST_AUDIT', blocking: false } }],

  formats: [
    {
      validFrom: '1900-01-01',
      value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true },
    },
  ],

  transmission: [{ validFrom: '1900-01-01', value: { channels: [{ type: 'EMAIL' }] } }],

  taxSystem: {
    kind: 'SALES_TAX',
    // Illustrative base state rates (state-level only; local add-ons omitted for the demo).
    stateRates: {
      CA: 7.25,
      NY: 4,
      TX: 6.25,
      WA: 6.5,
      FL: 6,
      IL: 6.25,
      // OR, MT, NH, DE have no state sales tax (absent → 0).
    },
    // States where this seller is registered / has nexus and must collect.
    nexusSubdivisions: ['CA', 'NY', 'TX', 'WA'],
    economicNexusNote: 'Economic nexus thresholds vary by state (commonly $100k or 200 transactions/yr).',
  },

  lifecycle: [
    {
      validFrom: '1900-01-01',
      value: {
        immutableAfter: 'NEVER',
        correctionModel: 'CREDIT_NOTE',
        correctionRoutes: [
          // The United States is a SOURCED NEGATIVE, and the statuses have to be read that way:
          // `OPEN` here means "no text forbids it", not "a text organises it". There is no federal
          // invoice at all — 26 U.S.C. § 6001 imposes RECORDS, not a DOCUMENT, and the IRS states
          // the law requires no particular kind of record. Recording the negative is what stops a
          // later reader from inferring a rule from silence.
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            legalRef: 'IRS Pub 583 ; 26 U.S.C. § 6001 — négatif établi',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'OPEN',
            legalRef: "Aucun instrument fédéral ni d'État trouvé — négatif",
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'OPEN',
            legalRef: 'Aucune forme prescrite, donc aucune forme interdite — négatif',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'OPEN',
            appliesTo: "Rien à annuler auprès de personne : aucun document n'a été déposé",
            legalRef: 'négatif',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'OPEN',
            appliesTo: 'Le cas NORMAL ici — toute correction est interne, rien ne part vers une autorité',
            legalRef: 'négatif',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // Structural, not prohibitive: there is no recipient authority to address.
            legalRef: 'Absence de tout portail fiscal de facturation — négatif',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'FORBIDDEN',
            appliesTo: 'Sans objet — aucun rejet possible, aucun système ne reçoit la facture',
            legalRef: 'négatif',
          },
        ],
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
  ],

  archival: [
    { validFrom: '1900-01-01', value: { retentionYears: 7, archivedForm: 'HYBRID_PDF', integrity: 'NONE' } },
  ],

  reporting: [],

  numbering: [{ validFrom: '1900-01-01', value: { model: 'GAPLESS_SELF' } }],

  requiredIdentifiers: [
    {
      scheme: 'LEGAL_ID',
      label: 'EIN',
      appliesTo: 'COMPANY',
      required: false,
      helpText: 'Employer Identification Number (optional for sole proprietors)',
    },
  ],
};
