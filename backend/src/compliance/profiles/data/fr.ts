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
        // P2-T07 — filtered by role now, and the note that stood here is corrected rather than
        // deleted, because its reasoning was checkable and did not check out.
        //
        // What was right: a domestic B2C sale is outside the e-invoicing mandate. Art. 289 bis I
        // covers the operations of art. 289 I 1 a and d — B2B and B2G — so a sale to a consumer is
        // not an "in-scope invoice" and must not be ROUTED through a PDP. That is a deduction from
        // the article's own scope, not a choice.
        //
        // What was wrong: the note deferred the fix by saying that filtering B2C out "would also
        // cut the data path" for e-reporting (art. 290 III), because `channels` serves both
        // purposes. Read against the code, that data path does not exist. All twelve consumers of
        // `plan.channels` transmit the INVOICE — registry.ts, assembler.ts, apply-signal.ts — and
        // e-reporting submission is a mock: report.processor.ts writes `mock-period-close:…` and
        // never reads `channels`. Nothing was being protected.
        //
        // What remains true is the lifecycle half: the assembler builds from `channels[0]`, so B2C
        // needed a channel rather than none — the rule below now provides one.
        appliesTo: { roles: ['B2B', 'B2G'] },
        attachment: [
          { kind: 'BOTH_ATTACHED_TO', country: 'FR' },
          { kind: 'NOT_OF_NATURE', nature: 'intraCommunitySupply' },
        ],
        channels: [{ type: 'PDP' }, { type: 'GOV_PORTAL_API', providerId: 'choruspro' }, { type: 'PEPPOL' }],
      },
    },
    // Operations outside the e-invoicing mandate keep an ordinary delivery channel: the e-reporting
    // DATA reaches the administration through the platform, but the INVOICE itself is not routed
    // through the CTC network.
    //
    // Two rules, not one, because two different things fall outside the mandate and they fail the
    // bilateral test differently. A cross-border operation fails it on attachment; a domestic B2C
    // sale passes the attachment test and falls outside on ROLE. One rule cannot express both, and
    // a B2C sale matching nothing would leave `channels` empty — which the lifecycle assembler,
    // reading `channels[0]`, cannot work from.
    {
      validFrom: '2026-09-01',
      value: {
        attachment: [{ kind: 'NOT_BOTH_ATTACHED_TO', country: 'FR' }],
        channels: [{ type: 'EMAIL' }],
      },
    },
    // Where the DATA goes — flux F10, art. 290 III. The e-reporting duty reaches the administration
    // through the accredited platform for EVERY operation in its scope, including the ones whose
    // invoice never touches that network: a domestic B2C sale is billed to the consumer by ordinary
    // means and its payment status ("encaissée") is still reported through the PDP.
    //
    // This rule is what makes filtering the B2C INVOICE out of the CTC channels safe. Removing the
    // PDP from `channels` without it would have cut a real path — `transmitStatus` resolves its
    // channel from the plan, and a B2C invoice marked paid would have had nowhere to report to.
    // I asserted otherwise after reading only report.processor.ts, whose period-close submission is
    // a mock; compliance-service.spec.ts contradicted it, correctly.
    {
      validFrom: '2026-09-01',
      value: {
        serves: 'E_REPORTING',
        attachment: [{ kind: 'BOTH_ATTACHED_TO', country: 'FR' }],
        channels: [{ type: 'PDP' }],
      },
    },
    // Domestic B2C. EMAIL is a PRODUCT default and is named as one: no rule prescribes how an
    // invoice reaches a consumer, so this is the same ordinary delivery the pre-2026 period used
    // and that the `noMandate` archetype uses everywhere the CTC network does not apply. What is
    // NOT a default is the absence of a PDP here — that follows from art. 289 bis I's scope.
    {
      validFrom: '2026-09-01',
      value: {
        appliesTo: { roles: ['B2C'] },
        attachment: [{ kind: 'BOTH_ATTACHED_TO', country: 'FR' }],
        channels: [{ type: 'EMAIL' }],
      },
    },
  ],

  /**
   * P2-T02 — the three layers, France only. Deadlines taken from
   * `docs/compliance/audit/03-LEGAL-VERIFICATION.md`, which sourced them against the
   * *spécifications externes* v3.2 and Légifrance; not re-sourced here.
   *
   * The ISSUANCE duty is also declared, not because the engine cannot derive one from `regime` —
   * it does — but because the regime carries no deadline and this layer has one.
   */
  obligations: [
    {
      validFrom: '2026-09-01',
      value: {
        layer: 'ISSUANCE' as const,
        kind: 'E_INVOICING' as const,
        // 24 h for the F1 flow, counted from the "Déposée" status timestamp — DSE §3.6.5.
        deadline: { value: 24, unit: 'HOURS' as const },
        // The DATE this binds depends on company SIZE — 2026-09-01 for large firms, ETI and members
        // of a single taxable entity; 2027-09-01 for SMEs, micro-enterprises and VAT-franchise
        // businesses (03-LEGAL-VERIFICATION §1). TransactionContext has no size field, so the rule
        // below binds from the earlier date for everyone, which over-states the duty for a small
        // supplier in the 2026-09-01 -> 2027-09-01 window. Said out loud rather than encoded wrong.
        openQuestion:
          'Entry into force is size-phased (GE/ETI 2026-09-01, PME/TPE 2027-09-01) and ' +
          'TransactionContext carries no company-size field, so this rule binds a year early for ' +
          'small suppliers. Needs a size input before the second date can be expressed.',
        appliesTo: { roles: ['B2B', 'B2G'] },
        attachment: [{ kind: 'BOTH_ATTACHED_TO' as const, country: 'FR' as const }],
      },
    },
    {
      validFrom: '2026-09-01',
      value: {
        layer: 'RECEPTION' as const,
        kind: 'E_INVOICING' as const,
        // Reception binds EVERY company from 2026-09-01, whatever its size — no phasing, unlike
        // issuance (03-LEGAL-VERIFICATION §1). The 24 h is the lifecycle-flow delay of DSE §3.6.6,
        // counted from the status timestamp; the statuses themselves are the four this profile
        // already lists under `lifecycle.response.statuses`.
        deadline: { value: 24, unit: 'HOURS' as const },
        // "Toutes les entreprises, quelle que soit la taille" — every COMPANY, which is the point
        // of contrast with issuance's size phasing. It is not every OPERATION: receiving an
        // e-invoice presupposes a taxable person on the buyer side, so a B2C sale carries no
        // reception duty. The universality is about who, not about what.
        appliesTo: { roles: ['B2B', 'B2G'] },
      },
    },
    {
      validFrom: '2026-09-01',
      value: {
        layer: 'ARCHIVAL' as const,
        kind: 'NONE' as const,
        // SIX years, LPF art. L102 B — the FISCAL retention, and the one an e-invoicing mandate
        // attaches to. `archival.retentionYears: 10` below is NOT this duty: ten years is
        // commercial law (C. com. art. L123-22) on its own clock, and 03-LEGAL-VERIFICATION flags
        // the profile's 10 as FR-D9, "approximatif et mal fondé", precisely for conflating them.
        // Left unchanged here because changing what the runtime retains is its own decision with
        // its own consequences; this states the fiscal duty correctly beside it.
        deadline: { value: 6, unit: 'YEARS' as const },
        openQuestion:
          'FR-D9: archival.retentionYears is 10 (commercial law, separate clock) while the fiscal ' +
          'duty is 6 (LPF L102 B). Which one the runtime should enforce is undecided.',
      },
    },
  ],

  taxSystem: {
    kind: 'VAT',
    standardRate: 20,
    reducedRates: [10, 5.5, 2.1],
    /**
     * France levies NO zero rate today. Its rates are 20 (CGI art. 278), 10 (art. 279 / 278 bis),
     * 5,5 (art. 278-0 bis) and 2,1 (art. 281 octies) — 0 is not among them.
     *
     * It is `false` rather than merely absent because France DID have one and it was repealed:
     * art. 278 ter taxed covid-19 vaccines and tests "au taux de 0 %" from 2021-01-01 and was
     * ABROGATED at 2023-01-01. So a 0% French domestic line is not a zero-rated supply; it is an
     * exemption (art. 261 and following — medical, education, financial) or outside the scope.
     * Légifrance, section « Taux » du CGI, consultée le 2026-08-28.
     *
     * KNOWN LIMIT, not an oversight: `taxSystem` is NOT `Temporal<>`, unlike every rule list on
     * this profile, so this field cannot say "true until 2023-01-01, false after". It states
     * TODAY's law. An invoice back-dated into the 2021–2022 window would be resolved on the
     * current rate table. Out of scope here — the mandate this profile serves starts 2026-09-01 —
     * and consciously left rather than half-built.
     *
     * Same expiry as the rest of this profile's citations: the whole « Taux » section is abrogated
     * at 2027-01-01 by Ord. n° 2025-1247, the same ordonnance FR-RATTACHEMENT.md §4 flags for
     * art. 289 bis and 290. The rates are not expected to change — recodification to the CIBS —
     * but the article numbers above go stale on that date.
     */
    hasDomesticZeroRate: false,
    schemes: ['STANDARD', 'FRANCHISE_BASE'],
  },

  /**
   * Les trois mentions de l'article L441-9 I al. 5 du code de commerce, dans une seule phrase :
   * « Elle précise les conditions d'escompte applicables en cas de paiement à une date antérieure
   * […], le taux des pénalités exigibles le jour suivant la date de règlement inscrite sur la
   * facture ainsi que le montant de l'indemnité forfaitaire pour frais de recouvrement due au
   * créancier en cas de retard de paiement. »
   *
   * Les trois sont `statutory: true` : la loi fournit la valeur, l'utilisateur n'a rien à saisir.
   * Un taux stipulé différent du supplétif serait, lui, un choix commercial — il n'est pas ici.
   *
   * Aucun libellé n'est imposé pour les deux premières : seul le CONTENU l'est (un montant, un
   * taux). Le « néant » de l'escompte est la formulation prescrite par la doctrine administrative
   * (entreprendre.service-public.gouv.fr, fiche F31808), pas par un texte.
   *
   * Sources consultées le 2026-08-29 : C. com. art. L441-9, L441-10 II, D441-5 (via
   * codes.droit.org, consolidation au 21/08/2026 — legifrance renvoie 403 aux requêtes
   * automatisées) ; entreprendre.service-public.gouv.fr F31808 et F23211 ; BCE, taux directeurs.
   *
   * NUANCE À CONNAÎTRE. superpdp rejette nos factures en invoquant une règle « BR-FR-05 » qui
   * exigerait ces mentions dans BG-1. Cette règle est INTROUVABLE dans les spécifications externes
   * DGFiP v3.2 (les règles françaises y sont numérotées G1.xx/G2.xx/G6.xx/P1.xx), et BG-1 y est
   * `0..n`, donc facultatif. Les porter en BG-1 reste néanmoins conforme — les trois codes sont
   * dans la liste UNTDID 4451 admise par BR-CL-08 — et c'est ce qui satisfait à la fois
   * l'obligation légale et le contrôle de la plateforme. Seul `AAB` est adossé à une règle DGFiP
   * (G1.52) ; `PMT` et `PMD` sont utilisés parce que la plateforme les attend, pas parce qu'un
   * texte français les désigne.
   */
  invoiceNotes: [
    {
      validFrom: '1900-01-01',
      value: {
        subjectCode: 'PMT',
        text: 'En cas de retard de paiement, une indemnité forfaitaire pour frais de recouvrement de {recoveryIndemnity} est due (art. L441-10 et D441-5 du code de commerce).',
        legalRef: 'C. com. art. L441-9 I al. 5, L441-10 II, D441-5',
        statutory: true,
      },
    },
    {
      validFrom: '1900-01-01',
      value: {
        subjectCode: 'PMD',
        text: "Tout retard de paiement entraîne des pénalités au taux de {lateFeeRate} l'an, exigibles le jour suivant la date de règlement figurant sur la facture, sans qu'un rappel soit nécessaire (art. L441-10 du code de commerce).",
        legalRef: 'C. com. art. L441-9 I al. 5, L441-10 II',
        statutory: true,
      },
    },
    {
      validFrom: '1900-01-01',
      value: {
        subjectCode: 'AAB',
        text: 'Escompte pour paiement anticipé : néant',
        legalRef: 'C. com. art. L441-9 I al. 5 ; formulation : service-public F31808',
        statutory: true,
      },
    },
  ],

  /**
   * Le taux supplétif est le taux de refinancement de la BCE majoré de 10 points, lu au 1er janvier
   * pour le premier semestre et au 1er juillet pour le second (L441-10 II). Il est donc daté, et
   * FIGÉ à l'émission : une facture de juillet garde le taux de juillet pour toujours.
   *
   * Plancher légal : un taux stipulé ne peut être inférieur à 3 fois le taux d'intérêt légal
   * (8,25 % au 2e semestre 2026 selon service-public). Le supplétif le dépasse largement, donc
   * l'appliquer satisfait le plancher sans calcul.
   *
   * À MAINTENIR DEUX FOIS PAR AN. La ligne ouverte ci-dessous porte le dernier taux connu ; quand
   * la BCE bouge, ajouter une entrée datée plutôt que modifier celle-ci.
   */
  noteValues: {
    recoveryIndemnity: [{ validFrom: '2012-01-01', value: '40 €' }],
    lateFeeRate: [
      // BCE MRO 2,15 % au 1er janvier 2026 → 12,15 %
      { validFrom: '2026-01-01', validTo: '2026-07-01', value: '12,15 %' },
      // BCE MRO 2,40 % depuis le 17 juin 2026, donc en vigueur au 1er juillet → 12,40 %
      { validFrom: '2026-07-01', value: '12,40 %' },
    ],
  },

  lifecycle: [
    // Pre-reform: immutable after issue, credit-note corrections, no mandatory status set.
    {
      validFrom: '1900-01-01',
      validTo: '2026-09-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        correctionRoutes: [
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            direction: 'DECREASE',
            appliesTo: 'Ventes résiliées ou annulées, rabais, remises, ristournes',
            // The BOFiP offers it as one of two: "soit l'envoi d'une facture nouvelle annulant et
            // remplaçant la précédente, soit […] l'envoi d'une note d'avoir". Never the only way.
            legalRef: 'CGI art. 272, 1 ; art. 289, I, 5 ; BOI-TVA-DED-40-10-20 § 60 et § 80',
          },
          {
            // Carve-out on the general rule above, and the reason one route needs two entries: the
            // credit note that is open for a cancelled sale is FORBIDDEN for a mere unpaid invoice —
            // "le non-paiement d'une facture n'appelle aucune rectification".
            route: 'CREDIT_NOTE',
            status: 'FORBIDDEN',
            appliesTo: 'Impayé pur — défaillance du débiteur',
            legalRef: 'BOI-TVA-DED-40-10-20 § 110',
          },
          {
            route: 'ANNOTATED_DUPLICATE',
            status: 'REQUIRED',
            appliesTo: 'Impayé — la contrepartie du CREDIT_NOTE interdit ci-dessus',
            // "consiste obligatoirement dans l'envoi d'un duplicata de la facture initiale […]
            // surchargées de la mention « Facture demeurée impayée pour la somme de … »". Neither a
            // credit note nor a corrective invoice: the same document, reissued annotated.
            legalRef: 'CGI art. 272, 1 et al. 3 ; BOI-TVA-DED-40-10-20 § 110',
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'OPEN',
            appliesTo: 'Toute modification référencée de la facture initiale',
            legalRef: 'CGI art. 289, I, 5 ; ann. II art. 242 nonies A, I ; BOI-TVA-DECLA-30-20-20-20 § 180',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'OPEN',
            appliesTo: "Ventes annulées ou résiliées, rabais — mention expresse de l'annulation requise",
            legalRef: 'BOI-TVA-DED-40-10-20 § 70 ; BOI-TVA-DECLA-30-20-20-20 § 240',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'OPEN',
            direction: 'INCREASE',
            // Open as a mechanism; whether France ever COMPELS one is unverified — unlike Italy,
            // whose art. 26 comma 1 does compel it. Recorded as open rather than guessed as required.
            appliesTo:
              "Hausse du montant — pas d'instrument distinct, une rectificative assimilée à une facture",
            legalRef: 'CGI art. 289, I, 5 ; BOI-TVA-DECLA-30-20-20-20 § 180',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // No "cancellation request" flux exists: the administration ANNULS the F1 itself as a
            // consequence of the lifecycle status. Status 220 "Annulée" is optional, outside the
            // mandatory set, and Chorus Pro does not relay it — it is not a correction route.
            legalRef: 'Spécifications externes DGFiP v2.4 p. 56/59/61 ; annexe Chorus Pro v1.1 p. 46-47',
          },
        ],
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
    // From 2026-09-01: mandatory lifecycle statuses exchanged between platforms.
    {
      validFrom: '2026-09-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        correctionRoutes: [
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            direction: 'DECREASE',
            appliesTo: 'Ventes résiliées ou annulées, rabais, remises, ristournes',
            // The BOFiP offers it as one of two: "soit l'envoi d'une facture nouvelle annulant et
            // remplaçant la précédente, soit […] l'envoi d'une note d'avoir". Never the only way.
            legalRef: 'CGI art. 272, 1 ; art. 289, I, 5 ; BOI-TVA-DED-40-10-20 § 60 et § 80',
          },
          {
            // Carve-out on the general rule above, and the reason one route needs two entries: the
            // credit note that is open for a cancelled sale is FORBIDDEN for a mere unpaid invoice —
            // "le non-paiement d'une facture n'appelle aucune rectification".
            route: 'CREDIT_NOTE',
            status: 'FORBIDDEN',
            appliesTo: 'Impayé pur — défaillance du débiteur',
            legalRef: 'BOI-TVA-DED-40-10-20 § 110',
          },
          {
            route: 'ANNOTATED_DUPLICATE',
            status: 'REQUIRED',
            appliesTo: 'Impayé — la contrepartie du CREDIT_NOTE interdit ci-dessus',
            // "consiste obligatoirement dans l'envoi d'un duplicata de la facture initiale […]
            // surchargées de la mention « Facture demeurée impayée pour la somme de … »". Neither a
            // credit note nor a corrective invoice: the same document, reissued annotated.
            legalRef: 'CGI art. 272, 1 et al. 3 ; BOI-TVA-DED-40-10-20 § 110',
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'OPEN',
            appliesTo: 'Toute modification référencée de la facture initiale',
            legalRef: 'CGI art. 289, I, 5 ; ann. II art. 242 nonies A, I ; BOI-TVA-DECLA-30-20-20-20 § 180',
          },
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'OPEN',
            appliesTo: "Ventes annulées ou résiliées, rabais — mention expresse de l'annulation requise",
            legalRef: 'BOI-TVA-DED-40-10-20 § 70 ; BOI-TVA-DECLA-30-20-20-20 § 240',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'OPEN',
            direction: 'INCREASE',
            // Open as a mechanism; whether France ever COMPELS one is unverified — unlike Italy,
            // whose art. 26 comma 1 does compel it. Recorded as open rather than guessed as required.
            appliesTo:
              "Hausse du montant — pas d'instrument distinct, une rectificative assimilée à une facture",
            legalRef: 'CGI art. 289, I, 5 ; BOI-TVA-DECLA-30-20-20-20 § 180',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'FORBIDDEN',
            // No "cancellation request" flux exists: the administration ANNULS the F1 itself as a
            // consequence of the lifecycle status. Status 220 "Annulée" is optional, outside the
            // mandatory set, and Chorus Pro does not relay it — it is not a correction route.
            legalRef: 'Spécifications externes DGFiP v2.4 p. 56/59/61 ; annexe Chorus Pro v1.1 p. 46-47',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'REQUIRED',
            transmission: 'FORBIDDEN',
            appliesTo: 'Statuts Refusée (210) et Rejetée (213)',
            whenOriginalStatus: ['REFUSED', 'REJECTED'],
            // The sentence P3-T03 exists to honour: "le fournisseur doit procéder à une annulation
            // comptable (avoir interne). Cette opération ne doit pas générer de flux de données
            // réglementaires (F1) au PPF." Present only from v3.1 (30/10/2025) — a recent rule.
            // The BUYER half is explicit only in the Chorus Pro annex (B2G) and archived v2.3/v2.4;
            // AFNOR XP Z12-014 would settle it for pure B2B and is paywalled. Hence the status is
            // carried on transmission as a whole rather than split per destination.
            legalRef: 'Spécifications externes DGFiP v3.2, 30/04/2026, § 3.6.4 p. 60',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'OPEN',
            appliesTo:
              'Deux cas étroits : rejet portant sur la constitution du F1, ou refus pour erreur de routage',
            // "peut alors générer à nouveau le fichier […] portant alors le même numéro de facture".
            // Covers the NUMBER; no version of the specifications addresses the DATE either way.
            legalRef: 'Spécifications externes DGFiP v3.2 § 3.6.9 p. 62 ; v2.4 p. 58',
          },
        ],
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
