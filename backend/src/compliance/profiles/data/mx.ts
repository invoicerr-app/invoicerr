import { CountryComplianceProfile } from '../schema';

/**
 * Mexico — see documentation/compliance/MX-Mexico.md and COMPLIANCE_ARCHITECTURE.md §16.4.
 * The canonical CLEARANCE case and the maximal contrast to the FR/US pair: every invoice is
 * validated by a PAC before it is legally valid (blocking), numbered from authority-allocated
 * folios, signed (CSD), reported in the local tax currency (MXN), archived in-country for 5 years,
 * and cancellable only with authority acknowledgement and buyer consent.
 */
export const MX: CountryComplianceProfile = {
  countryCode: 'MX',
  displayName: 'Mexico',
  schemaVersion: '1.0',
  confidence: 'OFFICIAL',

  regime: [
    // Clearance has been mandatory for all taxpayers since 2014; it BLOCKS validity until authorised.
    { validFrom: '2014-01-01', value: { model: 'CLEARANCE', blocking: true } },
  ],

  formats: [
    // National CFDI format, not buyer-negotiable. CFDI 3.3 then 4.0 (mandatory 2023-04-01).
    {
      validFrom: '2014-01-01',
      validTo: '2023-04-01',
      value: {
        primary: { syntax: 'CFDI', version: '3.3' },
        human: { syntax: 'PLAIN_PDF' },
        buyerNegotiable: false,
      },
    },
    {
      validFrom: '2023-04-01',
      value: {
        primary: { syntax: 'CFDI', version: '4.0' },
        human: { syntax: 'PLAIN_PDF' },
        buyerNegotiable: false,
      },
    },
  ],

  transmission: [
    { validFrom: '2014-01-01', value: { channels: [{ type: 'PAC' }], deliverToBuyerWithinHours: 72 } },
  ],

  taxSystem: {
    kind: 'VAT',
    standardRate: 16, // IVA
    reducedRates: [8], // northern border region
    schemes: ['STANDARD'],
    requiresTaxCurrency: 'MXN', // amounts must be reported in MXN (TipoCambio when invoiced in FX)
  },

  lifecycle: [
    {
      validFrom: '2022-01-01',
      value: {
        immutableAfter: 'CLEARANCE',
        correctionModel: 'CANCEL_AND_REPLACE',
        correctionRoutes: [
          {
            route: 'CANCEL_AND_REPLACE',
            status: 'REQUIRED',
            appliesTo: 'Quand le DOCUMENT lui-même est faux',
            // An ORDER is imposed, and getting it backwards leaves an un-substitutable folio: first
            // issue the correct CFDI carrying TipoRelacion 04 and the replaced folio, THEN request
            // the cancellation with motive 01 citing the new folio. Mexico is the country that needs
            // this route — and its profile used to declare CREDIT_NOTE, so the button never showed.
            legalRef: 'Guía de llenado Anexo 20 v4.0 Q42 ; CFF art. 29-A ¶6 ; RMF 2026 2.7.1.34 ¶5',
          },
          {
            route: 'AUTHORITY_ANNULMENT',
            status: 'REQUIRED',
            appliesTo:
              "Bornée à l'exercice d'émission ; acceptation du destinataire sous 3 jours, silence valant acceptation",
            // The only country of the seven where NOT cancelling is an offence: failing to cancel a
            // CFDI "emitido por error o sin una causa para ello" is sanctioned by CFF art. 81 fr.
            // XLVI. Two limits our lifecycle cannot express: the bound is a CALENDAR YEAR, not a
            // duration, and one exemption window is counted in BUSINESS DAYS ("día hábil siguiente")
            // where `cancellation.windowHours` only knows hours.
            legalRef: 'CFF art. 29-A ¶4-6 ; CFF art. 81 fr. XLVI ; RMF 2026 2.7.1.34 et 2.7.1.35',
          },
          {
            route: 'CREDIT_NOTE',
            status: 'OPEN',
            direction: 'DECREASE',
            appliesTo: 'CFDI tipo E — devoluciones, descuentos, bonificaciones, et les MONTANTS',
            // The SAT names it outright: "Este comprobante es conocido como nota de crédito". Unlike
            // the cancellation it is NOT bound to the fiscal year, so once the year closes it is the
            // only route left. This is why Mexico needs two routes and not one.
            legalRef: 'Guía de llenado Anexo 20 v4.0, Apéndice 2 ; c_TipoRelacion 01',
          },
          {
            route: 'DEBIT_NOTE',
            status: 'OPEN',
            direction: 'INCREASE',
            appliesTo: 'Aucun type dédié — un NOUVEAU CFDI tipo I relié en TipoRelacion 02',
            legalRef: 'Catalogue c_TipoRelacion 02 ; Guía de llenado Anexo 20 v4.0',
          },
          {
            route: 'CORRECTIVE_INVOICE',
            status: 'FORBIDDEN',
            // A stamped CFDI is immutable; there is no amend-by-reference instrument at all.
            legalRef: 'Par différence : CFF art. 29-A ¶4-6 ; Anexo 20',
          },
          {
            route: 'INTERNAL_CREDIT_NOTE',
            status: 'FORBIDDEN',
            // The only internal document the SAT documents is a control record for a FUTURE global
            // discount; it must be followed by a CFDI E and corrects no issued CFDI.
            legalRef: 'Guía de llenado Anexo 20 v4.0, remise globale future',
          },
          {
            route: 'LEDGER_ANNOTATION',
            status: 'FORBIDDEN',
            appliesTo: 'Comme voie autonome — le CFDI est le support fiscal',
            // Documentary support exists, but as an ACCESSORY duty of the cancellation: the issuer
            // must "justificar y soportar documentalmente el motivo".
            legalRef: 'CFF art. 29-A ¶6',
          },
          {
            route: 'COUNTERPARTY_OBJECTION',
            status: 'OPEN',
            appliesTo: "Le destinataire ne détruit pas le document, mais il peut REFUSER l'annulation",
            // A different shape from the German objection: it blocks the CORRECTION, not the
            // document. Twelve cases need no acceptance at all, including cancellation within the
            // next business day.
            legalRef: 'RMF 2026 2.7.1.34 ¶2-3 ; exemptions 2.7.1.35',
          },
          {
            route: 'RESUBMIT_SAME_IDENTITY',
            status: 'UNVERIFIED',
            openQuestion:
              "Un CFDI non timbré n'a pas d'existence fiscale et le folio est attribué par l'émetteur — la question se pose au niveau du PAC. Anexo 20 section I.F et les règles de certification PAC (RMF 2.7.2) le trancheraient.",
          },
        ],
        cancellation: { allowed: true, requiresAuthorityAck: true, requiresBuyerConsent: true },
      },
    },
  ],

  archival: [
    {
      validFrom: '2014-01-01',
      // MX-D3, NOT changed here — deliberately. The audit found `residency: 'MX'` stricter than the
      // sourced law: CFF art. 28 fr. III requires the documentation to "estar disponible en el
      // domicilio fiscal del contribuyente" and art. 30 to keep it "a disposición de las
      // autoridades", and no primary source found prohibits storage outside Mexico — the
      // requirement is availability at the tax domicile, not physical residency. But `residency`
      // also drives archive routing (ArchiveProviderRegistry.select picks a regional WORM bucket),
      // so dropping it moves existing Mexican documents from an in-country bucket to GLOBAL. That
      // is a data-location decision for the business, not an audit correction. Left as-is.
      //
      // MX-D4, NOT fixable here: the five years of CFF art. 30 run from the FILING of the relevant
      // return, not from invoice issuance, and are open-ended for constitutive acts, capital
      // movements, mergers, demergers, dividends and transfer-pricing evidence — and until a
      // dispute becomes final. ArchivalPolicy has only `retentionYears`, with no start point and no
      // per-document-class override, so the model cannot say this. Recorded rather than approximated.
      value: { retentionYears: 5, residency: 'MX', archivedForm: 'AUTHORITATIVE_XML', integrity: 'SIGNED' },
    },
  ],

  reporting: [],

  numbering: [
    // MX-D1. NOT an authority-allocated range: `Serie` and `Folio` are use="optional" in the SAT
    // schema vendored at compliance/schemas/mx/cfdv40.xsd, described by the Anexo 20 as "para
    // control interno del contribuyente". The fiscal identifier is the UUID, assigned per document
    // by the PAC at timbrado (TimbreFiscalDigital, RfcProvCertif) — the same shape as PL/KSeF and
    // IT/SdI: free internal number, authority identifier returned by the clearance.
    //
    // AUTHORITY_RANGE here did not merely leave dead code: NullAuthorityRangeSource never returns
    // a range, FolioPool.next() throws, and ComplianceService.issue() rethrows — every Mexican
    // issuance was blocked. utils/numbering.ts additionally refuses to self-assign under
    // AUTHORITY_RANGE, so the product path was blocked too. Folio ranges belonged to the abrogated
    // CFD/CBB regimes.
    { validFrom: '2014-01-01', value: { model: 'UNIQUE_SELF', seriesScope: 'ENTITY' } },
  ],

  requiredIdentifiers: [
    {
      scheme: 'RFC',
      label: 'RFC',
      appliesTo: 'BOTH',
      required: true,
      pattern: '^[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}$',
      helpText: '12-13 characters: 3-4 letters + 6 digits + 3 alphanumerics',
    },
    // MX-D2. CURP removed: it appears NOWHERE in the CFDI schema — `grep -c -i curp cfdv40.xsd`
    // returns 0. It belongs to the Nómina complement (payroll, natural persons), not to invoicing.
    // Requiring it would block issuance on a field the authority never asks for on a CFDI.
    //
    // Added instead: the two receiver attributes cfdv40.xsd declares use="required" and that are
    // properties of the PARTY, so this model can carry them.
    {
      scheme: 'MX_DOMICILIO_FISCAL',
      label: 'Domicilio fiscal (código postal)',
      appliesTo: 'BOTH',
      required: true,
      pattern: '^\\d{5}$',
      helpText:
        "5-digit postal code of the party's registered tax domicile (CFDI 4.0 DomicilioFiscalReceptor)",
    },
    {
      scheme: 'MX_REGIMEN_FISCAL',
      label: 'Régimen fiscal',
      appliesTo: 'BOTH',
      required: true,
      pattern: '^\\d{3}$',
      helpText: 'SAT c_RegimenFiscal code (CFDI 4.0 RegimenFiscalReceptor / RegimenFiscal)',
    },
    // NOT added: UsoCFDI. It is use="required" on the CFDI too, but it is a per-INVOICE choice
    // (what the buyer will use the document for), not a party identifier — this model has no place
    // for it. Recorded as a gap rather than forced into the wrong field.
  ],

  mandatoryReceiveSyntax: 'CFDI',
};
