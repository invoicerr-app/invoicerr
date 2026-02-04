import { CountryConfig } from '../../interfaces/country-config.interface';

/**
 * Italy-specific document configuration
 */
const IT_DOCUMENT_CONFIG = {
  builder: 'it',
  outputFormats: {
    invoice: ['pdf', 'fatturapa'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf', 'fatturapa'],
  },
  defaultFormat: 'fatturapa',
  modification: {
    invoiceEditable: false,
    quoteEditable: true,
    requiresCreditNote: true,
  },
  requiredElements: {
    invoice: ['signature'],
    quote: [],
  },
};

/**
 * Italy configuration
 * 
 * Transmission models:
 * - B2B: Sistema di Interscambio (SDI) - mandatory clearance model
 * - B2G: SDI (same as B2B)
 * - B2C: email
 * 
 * E-invoicing: FatturaPA (Italian XML format) - mandatory for all B2B/B2G
 * Digital signature: XAdES-BES required for SDI transmission
 */
export const itConfig: CountryConfig = {
  code: 'IT',
  name: 'country.italy',
  currency: 'EUR',
  locale: 'it-IT',
  timezone: 'Europe/Rome',
  isEU: true,
  euSince: '1958-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 22, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 10, labelKey: 'vat.reduced.10', category: 'AA' },
      { code: 'R2', rate: 5, labelKey: 'vat.reduced.5', category: 'AA' },
      { code: 'R3', rate: 4, labelKey: 'vat.reduced.4', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 22,
    exemptions: [
      {
        code: 'ART3',
        article: 'Art. 3 DPR 633/72',
        labelKey: 'vat.exemption.art3',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^IT[0-9]{11}$',
    numberPrefix: 'IT',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'vat.reverseCharge.intraEU',
      goods: 'vat.reverseCharge.intraEU',
    },
  },

  identifiers: {
    types: [
      { id: 'piva', labelKey: 'identifier.piva', format: '^\\d{11}$', required: true },
      { id: 'codicefiscale', labelKey: 'identifier.codicefiscale', format: '^[A-Za-z0-9 ]+$', required: false },
      { id: 'rea', labelKey: 'identifier.rea', format: '^\\d{7}-\\d{3}$', required: false },
    ],
    formats: {
      piva: { format: '{country}{piva}' },
    },
  },

  transmission: {
    b2b: { model: 'sdi', mandatory: true },
    b2g: { model: 'sdi', mandatory: true },
    b2c: { model: 'email', mandatory: false },
    crossBorder: {},
    exportDefault: 'peppol',
  },

  numbering: {
    prefix: '',
    format: '{type}{year}-{number::6}',
    resetPeriod: 'annual',
    seriesRequired: false,
  },

  format: {
    syntax: 'fatturapa',
    version: '1.2.2',
    profile: 'standard',
  },

  signature: {
    type: 'xades',
    algorithm: 'SHA256',
    required: true,
  },

  clearance: {
    endpoint: 'https://webservicestest.sdi.mf.gov.it',
    auth: 'certificate',
    idReturned: 'idFileSdI',
  },

  documents: IT_DOCUMENT_CONFIG,

  requiredFields: {
    invoice: ['clientId', 'items', 'piva', 'codicefiscale'],
    client: ['name', 'piva', 'address', 'postalCode', 'city', 'country'],
  },

  legalMentions: {
    mandatory: [
      'legal.italy.mandatory.1',
      'legal.italy.mandatory.2',
    ],
    conditional: [
      {
        condition: { type: 'supplier', property: 'exemptVat' },
        textKey: 'legal.italy.exemption',
      },
    ],
  },

  customFields: [],
};
