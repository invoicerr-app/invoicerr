import { CountryComplianceProfile } from '../schema';

/**
 * Germany — XRechnung CIUS, EN16931-based e-invoice.
 *
 * B2G mandate (Bundesleitfaden XRechnung): active since 2019-11-27 for federal/state
 * invoices above €1 000. Peppol-based Peppol BIS 3 is the primary network.
 *
 * B2B mandate (§14 UStG amendment, "ViDA-DE"):
 *   2025-01-01 — all businesses must be ABLE TO RECEIVE structured e-invoices (XRechnung or
 *                Peppol BIS 3 or EDIFACT). PDF/email still allowed for issuing.
 *   2027-01-01 — all businesses must ISSUE structured e-invoices to other German businesses.
 *
 * Primary format: XRECHNUNG (EN16931 CIUS; UBL 2.1 or CII — both accepted).
 * Peppol BIS 3.0 (a separate EN16931 CIUS) is used for Peppol 4-corner routing and B2G.
 * No clearance model — invoice is valid upon issuance (post-audit).
 * Validation: EN16931 CIUS XRechnung rules (BR-DE-* set).
 *
 * Refs: XRechnung v3 (KoSIT/DINI), ViDA-DE (BMF), openXRechnung.de
 */
export const DE: CountryComplianceProfile = {
  countryCode: 'DE',
  displayName: 'Germany',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [
    // Pre-2025: post-audit, B2G XRechnung is mandated; B2B is voluntary
    { validFrom: '1900-01-01', validTo: '2025-01-01', value: { model: 'POST_AUDIT', blocking: false } },
    // 2025+: receive mandate in force; issue mandate approaches; still no clearance
    { validFrom: '2025-01-01', value: { model: 'POST_AUDIT', blocking: false } },
  ],

  formats: [
    {
      validFrom: '1900-01-01',
      value: {
        primary: { syntax: 'XRECHNUNG', version: '3.0' },
        human: { syntax: 'PLAIN_PDF' },
        buyerNegotiable: true, // Peppol BIS 3 is also accepted by German receivers
      },
    },
  ],

  transmission: [
    // Peppol (4-corner) is the B2G delivery network; email remains common for B2B
    { validFrom: '1900-01-01', value: { channels: [{ type: 'PEPPOL' }, { type: 'EMAIL' }] } },
  ],

  taxSystem: { kind: 'VAT', standardRate: 19, reducedRates: [7], schemes: ['STANDARD'] },

  lifecycle: [
    {
      validFrom: '1900-01-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
  ],

  archival: [
    {
      // GoBD: 10 years for invoices, digital or paper; electronic archival must preserve integrity
      validFrom: '1900-01-01',
      value: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'NONE' },
    },
  ],

  reporting: [
    // UStVA (Umsatzsteuervoranmeldung) — VAT return (monthly / quarterly). Not per-invoice.
    // Tracked here as a reminder; the reporting engine handles batch VAT returns, not this row.
  ],

  numbering: [{ validFrom: '1900-01-01', value: { model: 'GAPLESS_SELF' } }],

  requiredIdentifiers: [
    {
      scheme: 'VAT',
      label: 'Umsatzsteuer-Identifikationsnummer (USt-IdNr.)',
      appliesTo: 'BOTH',          // DE VAT applies to companies and registered sole traders alike
      required: false,
      pattern: '^DE\\d{9}$',
      helpText: '9-digit EU VAT ID prefixed with DE (e.g. DE123456789)',
    },
    {
      scheme: 'LEGAL_ID',
      label: 'Handelsregisternummer',
      appliesTo: 'COMPANY',
      required: false,
      helpText: 'Commercial register number (Amtsgericht + HRB/HRA, e.g. HRB 12345 München)',
    },
    {
      scheme: 'LEITWEG_ID',
      label: 'Leitweg-ID (B2G routing)',
      appliesTo: 'COMPANY',
      required: false,
      helpText: 'Mandatory for federal/state B2G invoices; format: {Amtliche Gemeinde Schlüssel}--{optionale Ergänzung}-{Prüfziffer}',
    },
  ],

  // XRechnung reception is mandatory for German B2B buyers from 2025
  mandatoryReceiveSyntax: 'XRECHNUNG',
};
