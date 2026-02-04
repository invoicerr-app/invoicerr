import { CountryConfig } from '../../interfaces/country-config.interface';

/**
 * EU document configuration (PDF + XML formats)
 */
const EU_DOCUMENT_CONFIG = {
  builder: 'eu',
  outputFormats: {
    invoice: ['pdf', 'facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf', 'facturx'],
  },
  defaultFormat: 'zugferd',
  modification: {
    invoiceEditable: false,
    quoteEditable: true,
    requiresCreditNote: true,
  },
  requiredElements: {
    invoice: [],
    quote: [],
  },
};

/**
 * Germany configuration
 * 
 * Transmission models:
 * - B2B: Peppol or email
 * - B2G: XRechnung (via Peppol or email)
 * - B2C: email
 * 
 * E-invoicing: ZUGFeRD 2.1 (CII) for B2B, XRechnung (UBL) for B2G
 */
export const deConfig: CountryConfig = {
  code: 'DE',
  name: 'country.germany',
  currency: 'EUR',
  locale: 'de-DE',
  timezone: 'Europe/Berlin',
  isEU: true,
  euSince: '1958-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 19, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 7, labelKey: 'vat.reduced.7', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 19,
    exemptions: [
      {
        code: 'ART4',
        article: '§ 4 Nr. 1 UStG',
        labelKey: 'vat.exemption.art4',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'ART4B',
        article: '§ 4 Nr. 1b UStG',
        labelKey: 'vat.exemption.art4b',
        ublCode: 'VATEX-EU-AE',
      },
    ],
    numberFormat: '^DE[0-9]{9}$',
    numberPrefix: 'DE',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'vat.reverseCharge.intraEU',
      goods: 'vat.reverseCharge.intraEU',
    },
  },

  identifiers: {
    types: [
      { id: 'steuernummer', labelKey: 'identifier.steuernummer', format: '^\\d{11}$', required: true },
      { id: 'vat', labelKey: 'identifier.vat', format: '^DE[0-9]{9}$', required: false },
      { id: 'registergericht', labelKey: 'identifier.registergericht', format: '^[A-Za-z ]+$', required: false },
    ],
    formats: {},
  },

  transmission: {
    b2b: { model: 'peppol', mandatory: false },
    b2g: { model: 'xrechnung', mandatory: true },
    b2c: { model: 'email', mandatory: false },
    crossBorder: {},
    exportDefault: 'peppol',
  },

  numbering: {
    prefix: '',
    format: '{year}-{number::4}',
    resetPeriod: 'annual',
    seriesRequired: false,
  },

  format: {
    syntax: 'cii',
    version: '2.1',
    profile: 'zugferd',
  },

  peppol: {
    enabled: true,
    schemeId: '0009',
    participantIdFormat: '{steuernummer}',
  },

  documents: EU_DOCUMENT_CONFIG,

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate'],
    client: ['name', 'steuernummer', 'address', 'postalCode', 'city', 'country'],
  },

  legalMentions: {
    mandatory: [
      'legal.germany.mandatory.1',
      'legal.germany.mandatory.2',
    ],
    conditional: [],
  },

  customFields: [],
};
