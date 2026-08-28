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
        correctionModel: 'CREDIT_NOTE',
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
