import { CountryComplianceProfile } from '../schema';

/**
 * Spain — Facturae 3.2.2 + XAdES-BES / SII / Verifactu.
 *
 * Transmission & reporting timeline:
 *   2017-07-01 — SII (Suministro Inmediato de Información): VAT ledger reporting within 4 days
 *                for large taxpayers (SII-obligados). Mandates real-time upload to AEAT of
 *                LibroRegistro facturas expedidas/recibidas (SuministroLRFacturasEmitidas) — not
 *                per-invoice clearance. reporting kind: 'SII' (generateSiiRegistroPayload).
 *   2024-01-01 — SII extended; Facturae remains voluntary for B2B; B2G via FACe is mandatory.
 *   2027-01-01 — Verifactu (RD 1007/2023 / Orden HAC/1177/2024): mandatory for Corporate Income
 *                Tax taxpayers (Impuesto sobre Sociedades) — invoicing software must generate a
 *                signed hash-chain "Registro de facturación" (Huella) and, in VERI*FACTU mode,
 *                report it to AEAT in real time. reporting kind: 'VERIFACTU'
 *                (generateVerifactuRegistroPayload). NOT blocking clearance.
 *   2027-07-01 — Verifactu mandatory for the remaining taxpayers (autónomos / IRPF, non-sociedades).
 *                Originally 2026-01-01 / 2026-07-01 per Orden HAC/1177/2024; POSTPONED one year by
 *                Real Decreto-ley 15/2025 (2 December 2025) — confirmed via the official AEAT notice
 *                (sede.agenciatributaria.gob.es/.../nota-informativa-ampliacion-plazo-adaptacion-facturacion.html).
 *   TBD        — Full B2B mandate (Ley Crea y Crece, art. 12): dates announced iteratively;
 *                format: Facturae 3.2.2 + XAdES (unrelated to the SII/Verifactu reporting timeline).
 *
 * Format:
 *   Primary: ES_FACTURAE (Facturae 3.2.2 XML with XAdES-BES or XAdES-EPES enveloped signature).
 *   Transmission: AEAT SII portal for reporting; FACe / FACeB2B portal for government invoices.
 *   No blocking clearance — invoice effective at issuance.
 *
 * Refs: Facturae v3.2.2 (MINHAC), RD 1007/2023 + Orden HAC/1177/2024 + RDL 15/2025 (Verifactu),
 * Ley 25/2013 (B2G), SII AEAT (SuministroInformacion.xsd / SuministroLR.xsd).
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
    {
      validFrom: '1900-01-01',
      validTo: '2015-01-15',
      value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true },
    },
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
    {
      validFrom: '1900-01-01',
      validTo: '2017-07-01',
      value: { channels: [{ type: 'PEPPOL' }, { type: 'EMAIL' }] },
    },
    // SII era: B2G via FACe portal; B2B via AEAT SII real-time ledger upload (GOV_PORTAL_API)
    // NOTE: TransmissionRule has no appliesTo; role-based selection (B2G→FACe, B2B/reporting→
    // AEAT SII) is future engine work — mirrors fr.ts's B2B(PDP)/B2G(choruspro) note. In
    // practice a B2G supplier configures FACe credentials (es-face) and AEAT SII credentials
    // (es-aeat) independently; a B2B-only company has no FACe credentials, so es-face is
    // skipped for lack of credentials (F-6/F-8 honesty guard — never a false SENT/PENDING).
    {
      validFrom: '2017-07-01',
      value: {
        channels: [
          { type: 'GOV_PORTAL_API', providerId: 'es-face' }, // B2G: FACe (Ley 25/2013) mandatory entry point
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
        correctionModel: 'CORRECTIVE_INVOICE',
        correctionRoutes: [
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'REQUIRED',
            appliesTo: "Facture non conforme aux art. 6/7, ou survenance d'un cas de l'art. 80 LIVA",
            // "será obligatoria". Two methods, and the choice is FREE ("se podrán consignar"): by
            // differences, or by substitution showing the final figures — and BOTH must state the
            // delta. Delay: "tan pronto como tenga constancia", four years at most.
            legalRef: 'Art. 15.1, 15.2, 15.3, 15.5 RD 1619/2012',
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'REQUIRED',
            direction: 'INCREASE',
            appliesTo:
              'Deux cas nommés à la hausse : clôture du concours, et désistement ou accord de recouvrement (un mois)',
            // "deberá modificarla nuevamente al alza MEDIANTE LA EMISIÓN […] de una factura
            // rectificativa" — the duty falls on the rectificativa, not on a debit note.
            legalRef: 'Art. 80.Tres ¶2 et 80.Cuatro.C ¶2 LIVA ; art. 15.5 RD 1619/2012',
          },
          {
            route: 'CREDIT_NOTE',
            status: 'FORBIDDEN',
            direction: 'DECREASE',
            // Forbidden AS A DISTINCT DOCUMENT, exactly like Poland: Spain has ONE instrument and
            // signs it, "con independencia de su signo". The substantive duty to reduce lives on
            // CORRECTIVE_INVOICE above; what is denied here is a separate credit-note document.
            // Poland and Spain share this legal structure, so they must share the modelling — an
            // earlier draft gave them opposite statuses for the same arrangement.
            legalRef: 'Art. 15.4 et 15.5 ¶2 RD 1619/2012',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'FORBIDDEN',
            direction: 'INCREASE',
            // Same reason, other sign.
            legalRef: 'Art. 15.4 et 15.5 ¶2 RD 1619/2012',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'FORBIDDEN',
            // By ABSENCE OF MECHANISM, not by prohibition — the distinction matters because it is
            // the basis we encode. Art. 15.4 is a positive, exclusive prescription of form: "La
            // rectificación se realizará mediante la emisión de una nueva factura". Even the buyer
            // rejecting the invoice does not annul it.
            legalRef: 'Art. 15.4 et 15.6 RD 1619/2012',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'OPEN',
            appliesTo: 'Factures émises en sustitución o canje de factures SIMPLIFIÉES conformes',
            // The one breach, and it is bounded: these "no tendrán la condición de rectificativas".
            legalRef: 'Art. 15.6 ¶2 RD 1619/2012',
          },
          {
            route: 'LEDGER_ANNOTATION',
            status: 'REQUIRED',
            appliesTo: 'Erreur matérielle dans les annotations registrales',
            // "deberán rectificarlas tan pronto tengan constancia", by an annotation — no document
            // issued. Explicitly the route where NO rectificativa is due for REAV/REBU adjustments.
            legalRef: 'Art. 70.1 RD 1624/1992 ; art. 69 bis.1.a) ¶2 et 69 bis.3',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'FORBIDDEN',
            appliesTo: "Pour l'effet TVA",
            // Spain separates ISSUING from DELIVERING and hangs the effect on the second: in the
            // 80.Tres/Cuatro cases the taxpayer "deberá acreditar asimismo dicha remisión".
            legalRef: 'Art. 24.1 ¶2 RD 1624/1992',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // No request is ever addressed to the AEAT: the Veri*Factu annulment record is
            // SELF-GENERATED by the taxpayer's own system, and it annuls the RECORD, never the
            // invoice or its VAT effects. Two layers, not to be conflated.
            legalRef: 'Art. 8.2.a) ¶3 et art. 11.1 RD 1007/2023',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'OPEN',
            appliesTo: 'Couche registre Veri*Factu, après rejet AEAT (champs Subsanacion / RechazoPrevio)',
            legalRef: 'Orden HAC/1177/2024, anexo liste L17 ; art. 13.1',
          },
        ],
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
    // SII: daily/4-day ledger upload of issued invoice registers (SuministroLRFacturasEmitidas) to AEAT.
    // Capped at the Verifactu mandate date below — see note there on why the engine picks a single
    // reporting kind per date (it cannot yet select by taxpayer type / SII-obligado status; in
    // reality SII-obligados remain on SII and are exempt from Verifactu — RD 1007/2023 art. 3 — but
    // that per-taxpayer split is not representable by this profile's date-only temporal model yet).
    {
      validFrom: '2017-07-01',
      validTo: '2027-01-01',
      value: { kinds: ['SII'] },
    },
    // Verifactu: signed hash-chain register (Huella) + real-time reporting to AEAT.
    // Mandatory from 2027-01-01 for Impuesto sobre Sociedades taxpayers (this row); the remaining
    // taxpayers (autónomos/IRPF) follow on 2027-07-01 — both dates postponed one year from the
    // original Orden HAC/1177/2024 schedule by Real Decreto-ley 15/2025 (2 Dec 2025). The engine
    // does not yet model a same-country split by taxpayer type, so this single row conservatively
    // uses the earlier (sociedades) date; see the header comment for the full timeline + source.
    //
    // NOTE (temporal-resolution mechanics): `allByDate` (profiles/temporal.ts) returns every rule
    // whose window contains the date; when several match and none carry an `appliesTo` selector,
    // `pickWithSelector` (engine/compliance-engine.ts) takes the FIRST one in array order — NOT the
    // latest validFrom. Every other axis in this profile (regime, formats, transmission, …) already
    // caps each superseded row with `validTo` for exactly this reason; the original reporting array
    // did not, which meant the 2025-07-01 E_REPORTING row could never actually be selected once
    // 'SALES_PURCHASE_LEDGER' was also in force. Fixed here by capping SII's window above.
    {
      validFrom: '2027-01-01',
      value: { kinds: ['VERIFACTU'] },
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
