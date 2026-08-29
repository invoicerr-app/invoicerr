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
        correctionModel: 'CORRECTIVE_INVOICE',
        correctionRoutes: [
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'REQUIRED',
            appliesTo: 'Mentions des § 14 Abs. 4 / § 14a manquantes ou unzutreffend',
            // THE German route, and the one this profile used to hide behind `CREDIT_NOTE`. Only the
            // missing items need be sent, and the document must be "spezifisch und eindeutig auf die
            // Rechnung bezogen" — with a detail our numbering cannot yet express: "eine neue
            // Rechnungsnummer für dieses Dokument ist nicht erforderlich".
            legalRef: '§ 31 Abs. 5 UStDV ; UStAE 14.11 Abs. 1 S. 2, 4, 5, 11',
          },
          {
            route: 'NO_DOCUMENT_BY_LAW',
            status: 'OPEN',
            appliesTo: 'Skonti, Nachlässe, Rückgängigmachung — tout changement de base imposable',
            // The German DEFAULT, not a marginal case: § 17 Abs. 1 adjusts the tax by operation of
            // law and UStAE 14.11 Abs. 4 says "ist keine Rechnungsberichtigung erforderlich".
            // Modelling this as a credit note is precisely what was wrong before.
            legalRef: '§ 17 Abs. 1 UStG ; UStAE 14.11 Abs. 4 S. 1 ; UStAE 17.1 Abs. 3a S. 4-5',
          },
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            direction: 'DECREASE',
            // Open, never compelled: "Ein Beleg […] kann, muss aber nicht als umsatzsteuerliche
            // Rechnung ausgestellt werden."
            legalRef: 'UStAE 17.1 Abs. 3a S. 4-5',
          },
          {
            route: 'CREDIT_NOTE',
            status: 'REQUIRED',
            appliesTo:
              'Contrepartie modifiée conjointement sur des opérations taxées différemment (Jahresboni)',
            // The one case where an exchange of document IS prescribed — a Beleg showing the
            // allocation. "Ein Belegaustausch ist nur für die in § 17 Abs. 4 UStG bezeichneten Fälle
            // vorgeschrieben."
            legalRef: '§ 17 Abs. 4 UStG',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'OPEN',
            appliesTo: 'Toute correction — et la rétroactivité de la déduction peut lui être reconnue',
            // Limit worth carrying: several invoices for one supply not marked "Duplikat"/"Kopie"
            // trigger § 14c liability on EACH of them.
            legalRef: 'UStAE 15.2a Abs. 7 S. 5 (BFH 22/01/2020 XI R 10/17) ; limite UStAE 14c.1 Abs. 4 S. 5',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'FORBIDDEN',
            appliesTo: '§ 14c — lorsque la taxe a été mentionnée et la facture délivrée',
            // A correction that does not reach the recipient is worth nothing: "Dem
            // Leistungsempfänger muss eine hinreichend bestimmte, schriftliche Berichtigung
            // tatsächlich zugehen."
            legalRef: 'UStAE 14c.1 Abs. 7 S. 1-2',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'REQUIRED',
            appliesTo: 'Unberechtigter Steuerausweis — § 14c Abs. 2, étendu par Abs. 1 S. 3',
            // The surprise: Germany, filed under "no authority", has one. "Die Berichtigung […] ist
            // beim Finanzamt gesondert schriftlich zu beantragen und nach dessen Zustimmung […]
            // vorzunehmen." NOTE it annuls the TAX, not the invoice — which is why
            // `cancellation.requiresAuthorityAck` below is deliberately left false: that flag gates
            // cancelling the DOCUMENT, and stretching it to cover a tax-correction procedure would
            // be a different rule than the one the text states.
            legalRef: '§ 14c Abs. 2 S. 3-5 UStG ; UStAE 14c.1 Abs. 11',
          },
          {
            route: 'COUNTERPARTY_OBJECTION',
            status: 'OPEN',
            appliesTo: "Gutschrift — le fournisseur peut la détruire en s'y opposant",
            // "verliert die Wirkung einer Rechnung", effective on receipt, ex nunc, and
            // "grundsätzlich unbefristet möglich" — a cancellation by the counterparty, with no
            // time limit at all. Nothing in the runtime models an action taken by the other side.
            legalRef: '§ 14 Abs. 2 Satz 6 UStG ; UStAE 14.3 Abs. 4 S. 7-9',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'OPEN',
            appliesTo: 'Renvoi du même fichier de facture électronique',
            legalRef: 'UStAE 14c.1 Abs. 4 S. 6-7',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'UNVERIFIED',
            direction: 'INCREASE',
            openQuestion:
              'Aucun texte trouvé qui autorise ou interdise un document de débit distinct. UStAE Abschnitt 17.1 dans son intégralité, ou un BMF-Schreiben sur les Entgelterhöhungen, le trancherait.',
          },
        ],
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
  ],

  archival: [
    // DE-D1: EIGHT years, not ten. § 14b Abs. 1 Satz 1 UStG reads "acht Jahre aufzubewahren"
    // since the Viertes Bürokratieentlastungsgesetz, in force 2025-01-01 (§ 27 Abs. 40 UStG applies
    // it to every invoice whose period had not expired on 2024-12-31). § 147 Abs. 3 AO keeps ten
    // years for books, balance sheets and inventories — not for Buchungsbelege, which invoices are.
    // Over-retaining is not the safe direction: it is personal data kept two years too long.
    {
      validFrom: '1900-01-01',
      validTo: '2025-01-01',
      value: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'NONE' },
    },
    {
      validFrom: '2025-01-01',
      // DE-D2: `integrity: NONE` is also wrong — § 14 Abs. 3 UStG requires Echtheit der Herkunft,
      // Unversehrtheit des Inhalts and Lesbarkeit, and § 14b Abs. 1 S. 2 requires them for the whole
      // retention period. The means is free (internal controls with a reliable audit trail, a
      // qualified eIDAS signature/seal, or EDI), which this enum cannot express — it offers only
      // NONE | HASH_CHAIN | SIGNED, none of which is "mandatory, means free". Left at NONE with this
      // note rather than asserting HASH_CHAIN or SIGNED, neither of which German law requires.
      // Modelling that properly is a schema change, not a value change.
      value: { retentionYears: 8, archivedForm: 'BOTH', integrity: 'NONE' },
    },
  ],

  reporting: [
    // UStVA (Umsatzsteuervoranmeldung) — VAT return (monthly / quarterly). Not per-invoice.
    // Tracked here as a reminder; the reporting engine handles batch VAT returns, not this row.
  ],

  // § 14 Abs. 4 Nr. 4 UStG requires a number "die … einmalig vergeben wird"; UStAE 14.5 Abs. 10:
  // "Eine lückenlose Abfolge der ausgestellten Rechnungsnummern ist nicht zwingend." (DE-D4)
  numbering: [{ validFrom: '1900-01-01', value: { model: 'UNIQUE_SELF' } }],

  requiredIdentifiers: [
    {
      scheme: 'VAT',
      label: 'Umsatzsteuer-Identifikationsnummer (USt-IdNr.)',
      appliesTo: 'BOTH', // DE VAT applies to companies and registered sole traders alike
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
      helpText:
        'Mandatory for federal/state B2G invoices; format: {Amtliche Gemeinde Schlüssel}--{optionale Ergänzung}-{Prüfziffer}',
    },
  ],

  // XRechnung reception is mandatory for German B2B buyers from 2025
  mandatoryReceiveSyntax: 'XRECHNUNG',
};
