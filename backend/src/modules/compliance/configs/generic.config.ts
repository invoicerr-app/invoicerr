import { CountryConfig } from '../../interfaces/country-config.interface';

/**
 * Generic document configuration (simple PDF, no XML)
 */
const GENERIC_DOCUMENT_CONFIG = {
  builder: 'generic',
  outputFormats: {
    invoice: ['pdf'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf'],
  },
  defaultFormat: 'pdf',
  modification: {
    invoiceEditable: true,
    quoteEditable: true,
    requiresCreditNote: false,
  },
  requiredElements: {
    invoice: [],
    quote: [],
  },
};

/**
 * Default configuration for unsupported countries
 */
export const genericConfig: Partial<CountryConfig> = {
  code: 'GENERIC',
  name: 'country.generic',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'UTC',
  isEU: false,

  vat: {
    rates: [
      { code: 'S', rate: 20, labelKey: 'vat.standard', category: 'S' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 20,
    exemptions: [],
    numberFormat: '^[A-Z]{2}[0-9A-Z]{8,12}$',
    numberPrefix: '',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'vat.reverseCharge.services',
      goods: 'vat.reverseCharge.goods',
    },
  },

  identifiers: {
    types: [
      { id: 'vat', labelKey: 'identifier.vat', format: '^[A-Z]{2}[0-9A-Z]{8,12}$', required: false },
    ],
    formats: {},
  },

  transmission: {
    b2b: { model: 'email', mandatory: false },
    b2g: { model: 'email', mandatory: false },
    b2c: { model: 'email', mandatory: false },
    crossBorder: {},
    exportDefault: 'email',
  },

  numbering: {
    prefix: 'INV',
    format: '{prefix}-{year}-{number::6}',
    resetPeriod: 'annual',
    seriesRequired: false,
  },

  format: {
    syntax: 'ubl',
    version: '2.1',
    profile: 'basic',
  },

  documents: GENERIC_DOCUMENT_CONFIG,

  requiredFields: {
    invoice: ['clientId', 'items'],
    client: ['name', 'email'],
  },

  legalMentions: {
    mandatory: [],
    conditional: [],
  },

  customFields: [],
} as CountryConfig;
