import { CountryConfig } from '../../interfaces/country-config.interface';

/**
 * Portugal-specific document configuration
 */
const PT_DOCUMENT_CONFIG = {
  builder: 'pt',
  outputFormats: {
    invoice: ['pdf', 'saft'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf', 'saft'],
  },
  defaultFormat: 'saft',
  modification: {
    invoiceEditable: false,
    quoteEditable: true,
    requiresCreditNote: true,
  },
  requiredElements: {
    invoice: ['hash'],
    quote: [],
  },
};

/**
 * Portugal configuration
 * 
 * Transmission models:
 * - B2B: e-Fatura (ATCUD system)
 * - B2G: e-Fatura (same as B2B)
 * - B2C: email
 * 
 * E-invoicing: SAF-T (Standard Audit File for Tax)
 * Hash chain: Required for sequential invoice validation (based on previous invoice hash)
 */
export const ptConfig: CountryConfig = {
  code: 'PT',
  name: 'country.portugal',
  currency: 'EUR',
  locale: 'pt-PT',
  timezone: 'Europe/Lisbon',
  isEU: true,
  euSince: '1986-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 23, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 13, labelKey: 'vat.reduced.13', category: 'AA' },
      { code: 'R2', rate: 9, labelKey: 'vat.reduced.9', category: 'AA' },
      { code: 'R3', rate: 6, labelKey: 'vat.reduced.6', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 23,
    exemptions: [
      {
        code: 'ART9',
        article: 'Art. 9º do CIVA',
        labelKey: 'vat.exemption.art9',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^PT[0-9]{9}$',
    numberPrefix: 'PT',
    roundingMode: 'line',
    reverseChargeTexts: {
      services: 'vat.reverseCharge.intraEU',
      goods: 'vat.reverseCharge.intraEU',
    },
  },

  identifiers: {
    types: [
      { id: 'nif', labelKey: 'identifier.nif', format: '^\\d{9}$', required: true },
      { id: 'nipc', labelKey: 'identifier.nipc', format: '^\\d{9}$', required: false },
      { id: 'cae', labelKey: 'identifier.cae', format: '^\\d{7}/\\d{3}$', required: false },
    ],
    formats: {
      nif: { format: '{country}{nif}' },
    },
  },

  transmission: {
    b2b: { model: 'efatura', mandatory: true },
    b2g: { model: 'efatura', mandatory: true },
    b2c: { model: 'email', mandatory: false },
    crossBorder: {},
    exportDefault: 'peppol',
  },

  numbering: {
    prefix: '',
    format: '{type} {year}/{number::5}',
    resetPeriod: 'annual',
    seriesRequired: false,
  },

  format: {
    syntax: 'saft',
    version: '1.04',
    profile: 'standard',
  },

  archiving: {
    periodYears: 10,
    format: 'saft-pt',
  },

  qrCode: {
    content: '{qrData}',
    format: 'qr',
    position: 'footer',
    required: true,
  },

  documents: PT_DOCUMENT_CONFIG,

  requiredFields: {
    invoice: ['clientId', 'items', 'nif', 'cae'],
    client: ['name', 'nif', 'address', 'postalCode', 'city', 'country'],
  },

  legalMentions: {
    mandatory: [
      'legal.portugal.mandatory.1',
      'legal.portugal.mandatory.2',
    ],
    conditional: [],
  },

  customFields: [],
};
