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
    // Folio fiscal (UUID) assigned by SAT at clearance → authority-allocated, not self-sequenced.
    { validFrom: '2014-01-01', value: { model: 'AUTHORITY_RANGE', seriesScope: 'ENTITY' } },
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
    {
      scheme: 'CURP',
      label: 'CURP',
      appliesTo: 'INDIVIDUAL',
      required: true,
      pattern: '^[A-Z]{4}\\d{6}[HM][A-Z]{2}\\d{3}$',
      helpText: '18 characters: letters + digits for individual identification',
    },
  ],

  mandatoryReceiveSyntax: 'CFDI',
};
