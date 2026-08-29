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
        correctionRoutes: [
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            direction: 'DECREASE',
            appliesTo:
              'Nullità, annullamento, revoca, risoluzione, rescissione e simili ; abbuoni e sconti ; comma 3-bis',
            // A FACULTY, and the law says so twice: comma 2 "ha diritto di", commas 9 and 10 calling
            // it "la facoltà di cui al comma 2". One year only when the reduction stems from a
            // "sopravvenuto accordo fra le parti"; otherwise no time limit at all.
            legalRef: 'Art. 26 DPR 633/72 commi 2, 3, 9 e 10',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'REQUIRED',
            direction: 'INCREASE',
            appliesTo: 'Toute hausse de la base ou de la taxe, per qualsiasi motivo',
            // The asymmetry this whole direction axis exists for: "Le disposizioni degli articoli 21
            // e seguenti DEVONO ESSERE OSSERVATE, in relazione al maggiore ammontare". The increase
            // compels; the decrease does not. Poland answers the same question with one instrument.
            legalRef: 'Art. 26 DPR 633/72 comma 1',
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'FORBIDDEN',
            // Non-existent rather than prohibited: the provvedimento frames every variation as a
            // nota di credito or di debito ex art. 26, leaving no amend-by-reference instrument.
            legalRef: 'Provv. AdE 89757/2018, punto 6.1',
          },
          {
            route: 'LEDGER_ANNOTATION',
            status: 'OPEN',
            appliesTo: 'Erreurs matérielles ou de calcul dans les registres et liquidations',
            // A correction with NO document issued and none transmitted — "possono essere effettuate
            // […] anche mediante apposite annotazioni in rettifica […] sui registri".
            legalRef: 'Art. 26 DPR 633/72 commi 7 e 8',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // Concluded by exhaustiveness of the provvedimento (zero occurrences of "annull-"), not
            // by a prohibiting sentence — the one status here inferred from silence rather than read.
            // Punto 6.2: buyer-side variation requests "non sono gestite dal SdI".
            legalRef: 'Provv. AdE 89757/2018, punti 6.1 e 6.2',
          },
        ],
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
        correctionRoutes: [
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            direction: 'DECREASE',
            appliesTo:
              'Nullità, annullamento, revoca, risoluzione, rescissione e simili ; abbuoni e sconti ; comma 3-bis',
            // A FACULTY, and the law says so twice: comma 2 "ha diritto di", commas 9 and 10 calling
            // it "la facoltà di cui al comma 2". One year only when the reduction stems from a
            // "sopravvenuto accordo fra le parti"; otherwise no time limit at all.
            legalRef: 'Art. 26 DPR 633/72 commi 2, 3, 9 e 10',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'REQUIRED',
            direction: 'INCREASE',
            appliesTo: 'Toute hausse de la base ou de la taxe, per qualsiasi motivo',
            // The asymmetry this whole direction axis exists for: "Le disposizioni degli articoli 21
            // e seguenti DEVONO ESSERE OSSERVATE, in relazione al maggiore ammontare". The increase
            // compels; the decrease does not. Poland answers the same question with one instrument.
            legalRef: 'Art. 26 DPR 633/72 comma 1',
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'FORBIDDEN',
            // Non-existent rather than prohibited: the provvedimento frames every variation as a
            // nota di credito or di debito ex art. 26, leaving no amend-by-reference instrument.
            legalRef: 'Provv. AdE 89757/2018, punto 6.1',
          },
          {
            route: 'LEDGER_ANNOTATION',
            status: 'OPEN',
            appliesTo: 'Erreurs matérielles ou de calcul dans les registres et liquidations',
            // A correction with NO document issued and none transmitted — "possono essere effettuate
            // […] anche mediante apposite annotazioni in rettifica […] sui registri".
            legalRef: 'Art. 26 DPR 633/72 commi 7 e 8',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // Concluded by exhaustiveness of the provvedimento (zero occurrences of "annull-"), not
            // by a prohibiting sentence — the one status here inferred from silence rather than read.
            // Punto 6.2: buyer-side variation requests "non sono gestite dal SdI".
            legalRef: 'Provv. AdE 89757/2018, punti 6.1 e 6.2',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'REQUIRED',
            transmission: 'FORBIDDEN',
            appliesTo: 'Après scarto SdI, si la facture avait déjà été comptabilisée',
            // Italy has the same trap as France, and nobody was looking for it here: "una variazione
            // contabile valida ai soli fini interni SENZA LA TRASMISSIONE DI ALCUNA NOTA DI
            // VARIAZIONE AL SdI". Two countries, same route, same forbidden transmission.
            legalRef: 'Provv. AdE 89757/2018, punto 6.3 ; circolare 13/E du 02/07/2018 § 1.6 p. 11',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'OPEN',
            appliesTo: "Après scarto, dans les 5 jours, sous les date et numéro d'origine",
            // "vada PREFERIBILMENTE emessa […] con la data ed il numero del documento originario" —
            // recommended, never required. A scartato file "si considera non emessa", which is why
            // the uniqueness check reopens the number/year pair after a ricevuta di scarto.
            legalRef: 'Circolare 13/E § 1.6 ; specifiche tecniche allegato A v1.6.3 p. 150',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'OPEN',
            appliesTo: 'Après scarto UNIQUEMENT — inexistant une fois la facture livrée',
            legalRef: 'Circolare 13/E du 02/07/2018, § 1.6 p. 12',
          },
        ],
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

  // Art. 21 c. 2 lett. b) DPR 633/72: "numero progressivo che la identifichi in modo univoco".
  // The "per anno solare" wording was repealed in 2013; Ris. AdE 1/E of 10/01/2013 admits any
  // progressive scheme that identifies uniquely. (IT-D2)
  numbering: [{ validFrom: '1900-01-01', value: { model: 'UNIQUE_SELF', seriesScope: 'ENTITY' } }],

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
