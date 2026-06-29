import { CountryComplianceProfile } from '../schema';

/**
 * Spain — Facturae 3.2.2 + XAdES-BES / Verifactu.
 *
 * Transmission & reporting timeline:
 *   2017-07-01 — SII (Suministro Inmediato de Información): VAT ledger reporting within 4 days
 *                for large taxpayers (SII-obligados). Mandates real-time upload to AEAT of
 *                LibroRegistro facturas expedidas/recibidas (not per-invoice clearance).
 *   2024-01-01 — SII extended; Facturae remains voluntary for B2B; B2G via FACe is mandatory.
 *   2025-07-01 — Verifactu (RD 1007/2023): new software anti-fraud requirements — all invoice
 *                software must generate a Registro de Verifactu (signed hash-chain JSON) AND
 *                report eligible invoices to AEAT within 4 days. NOT blocking clearance.
 *   TBD        — Full B2B mandate (Ley Crea y Crece, art. 12): dates announced iteratively;
 *                currently expected 2025-2026 for large companies. Format: Facturae 3.2.2 + XAdES.
 *
 * Format:
 *   Primary: ES_FACTURAE (Facturae 3.2.2 XML with XAdES-BES or XAdES-EPES enveloped signature).
 *   Transmission: AEAT SII portal for reporting; FACe / FACeB2B portal for government invoices.
 *   No blocking clearance — invoice effective at issuance.
 *
 * Refs: Facturae v3.2.2 (MINHAC), RD 1007/2023 (Verifactu), Ley 25/2013 (B2G), SII AEAT.
 */
export const ES: CountryComplianceProfile = {
  countryCode: 'ES',
  displayName: 'Spain',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [
    // Pre-SII: post-audit
    { validFrom: '1900-01-01', validTo: '2017-07-01', value: { model: 'POST_AUDIT', blocking: false } },
    // SII era: real-time reporting obligation (4-day ledger upload), no clearance gate
    { validFrom: '2017-07-01', value: { model: 'REAL_TIME_REPORTING', blocking: false } },
  ],

  formats: [
    // Pre-B2G mandate: PDF / plain
    { validFrom: '1900-01-01', validTo: '2015-01-15', value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } },
    // B2G mandate (Ley 25/2013): Facturae 3.2.2 for public administration invoices
    {
      validFrom: '2015-01-15',
      value: {
        primary: { syntax: 'ES_FACTURAE', version: '3.2.2' },
        human: { syntax: 'PLAIN_PDF' },
        // B2G: mandatory; B2B: voluntary but heading to mandate (Crea y Crece)
        buyerNegotiable: true,
      },
    },
  ],

  transmission: [
    // Pre-SII: email / Peppol
    { validFrom: '1900-01-01', validTo: '2017-07-01', value: { channels: [{ type: 'PEPPOL' }, { type: 'EMAIL' }] } },
    // SII era: B2G via FACe portal; B2B via AEAT SII real-time ledger upload (GOV_PORTAL_API)
    {
      validFrom: '2017-07-01',
      value: {
        channels: [
          { type: 'GOV_PORTAL_API', providerId: 'es-aeat' }, // SII + Verifactu reporting
          { type: 'PEPPOL' },
          { type: 'EMAIL' },
        ],
      },
    },
  ],

  taxSystem: { kind: 'VAT', standardRate: 21, reducedRates: [10, 4], schemes: ['STANDARD'] },

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
      // Spain: 4 years statute of limitations; 10 years prudent minimum
      validFrom: '1900-01-01',
      value: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'SIGNED' },
    },
  ],

  reporting: [
    // SII: daily/4-day ledger upload of issued/received invoice registers to AEAT
    {
      validFrom: '2017-07-01',
      value: { kinds: ['SALES_PURCHASE_LEDGER'] },
    },
    // Verifactu: signed hash-chain register + reporting to AEAT (RD 1007/2023)
    {
      validFrom: '2025-07-01',
      value: { kinds: ['E_REPORTING'] },
    },
  ],

  numbering: [{ validFrom: '1900-01-01', value: { model: 'GAPLESS_SELF', seriesScope: 'YEAR' } }],

  requiredIdentifiers: [
    {
      scheme: 'VAT',
      label: 'NIF / CIF (Número de Identificación Fiscal)',
      appliesTo: 'BOTH',
      required: true,
      pattern: '^(ES)?[A-Z0-9]\\d{7}[A-Z0-9]$',
      helpText: 'Spanish tax ID (9 chars): DNI/NIE for individuals, CIF for companies',
    },
    {
      scheme: 'LEGAL_ID',
      label: 'Número de Registro Mercantil',
      appliesTo: 'COMPANY',
      required: false,
      helpText: 'Commercial register number',
    },
  ],

  mandatoryReceiveSyntax: 'ES_FACTURAE',
};
