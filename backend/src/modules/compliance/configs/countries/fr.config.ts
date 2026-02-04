import { CountryConfig } from '../../interfaces/country-config.interface';

/**
 * EU document configuration (PDF + XML formats)
 */
const EU_DOCUMENT_CONFIG = {
  builder: 'eu',
  outputFormats: {
    invoice: ['pdf', 'facturx', 'zugferd', 'ubl', 'cii'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf', 'facturx'],
  },
  defaultFormat: 'facturx',
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
 * France configuration
 * 
 * Transmission models:
 * - B2B: SuperPDP (Certified PDP) or email
 * - B2G: Chorus Pro (public sector)
 * - B2C: email
 * 
 * E-invoicing: Factur-X (CII) for both B2B and B2G
 */
export const frConfig: CountryConfig = {
  code: 'FR',
  name: 'country.france',
  currency: 'EUR',
  locale: 'fr-FR',
  timezone: 'Europe/Paris',
  isEU: true,
  euSince: '1958-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 20, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 10, labelKey: 'vat.reduced.10', category: 'AA' },
      { code: 'R2', rate: 5.5, labelKey: 'vat.reduced.5_5', category: 'AA' },
      { code: 'R3', rate: 2.1, labelKey: 'vat.reduced.2_1', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 20,
    exemptions: [
      {
        code: 'ART44',
        article: 'Article 44 II-1° du CGI',
        labelKey: 'vat.exemption.art44',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'ART261',
        article: 'Article 261-7° du CGI',
        labelKey: 'vat.exemption.art261',
        ublCode: 'VATEX-EU-AE',
      },
    ],
    numberFormat: '^FR[A-HJ-NP-Z0-9]{11}$',
    numberPrefix: 'FR',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'vat.reverseCharge.intraEU',
      goods: 'vat.reverseCharge.intraEU',
    },
  },

  identifiers: {
    types: [
      { id: 'siret', labelKey: 'identifier.siret', format: '^\\d{14}$', required: true },
      { id: 'siren', labelKey: 'identifier.siren', format: '^\\d{9}$', required: false },
      { id: 'vat', labelKey: 'identifier.vat', format: '^FR[A-HJ-NP-Z0-9]{11}$', required: false },
      { id: 'naf', labelKey: 'identifier.naf', format: '^\\d{4}[A-Z]{2}$', required: false },
    ],
    formats: {
      siret: { format: '{siren}{establishment}' },
    },
  },

  transmission: {
    b2b: { model: 'superpdp', mandatory: false },
    b2g: { model: 'chorus', mandatory: true },
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
    syntax: 'cii',
    version: '1.0',
    profile: 'facturx',
  },

  peppol: {
    enabled: true,
    schemeId: '0009',
    participantIdFormat: '{siret}',
  },

  documents: EU_DOCUMENT_CONFIG,

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate'],
    client: ['name', 'siret', 'address', 'postalCode', 'city', 'country'],
  },

  legalMentions: {
    mandatory: [
      'legal.france.mandatory.1',
      'legal.france.mandatory.2',
    ],
    conditional: [
      {
        condition: { type: 'supplier', property: 'exemptVat' },
        textKey: 'legal.france.exemption',
      },
    ],
  },

  customFields: [],
};
