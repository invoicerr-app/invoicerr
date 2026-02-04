import { CountryConfig } from '../../interfaces/country-config.interface';

/**
 * Spain-specific document configuration
 */
const ES_DOCUMENT_CONFIG = {
  builder: 'es',
  outputFormats: {
    invoice: ['pdf', 'facturae'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf', 'facturae'],
  },
  defaultFormat: 'facturae',
  modification: {
    invoiceEditable: false,
    quoteEditable: true,
    requiresCreditNote: true,
  },
  requiredElements: {
    invoice: ['hash', 'signature'],
    quote: [],
  },
};

/**
 * Spain configuration
 * 
 * Transmission models:
 * - B2B: Veri*Factu (real-time reporting) - mandatory
 * - B2G: FACeB2B (similar to B2B)
 * - B2C: email
 * 
 * E-invoicing: FacturaE (Spanish XML format)
 * Hash chain: Required for sequential invoice validation
 * Digital signature: XAdES required for Veri*Factu
 */
export const esConfig: CountryConfig = {
  code: 'ES',
  name: 'country.spain',
  currency: 'EUR',
  locale: 'es-ES',
  timezone: 'Europe/Madrid',
  isEU: true,
  euSince: '1986-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 21, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 10, labelKey: 'vat.reduced.10', category: 'AA' },
      { code: 'R2', rate: 4, labelKey: 'vat.reduced.4', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 21,
    exemptions: [
      {
        code: 'ART20',
        article: 'Art. 20 LIVA',
        labelKey: 'vat.exemption.art20',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^ES[A-Z]{2}[0-9]{8}[A-Z0-9]?$',
    numberPrefix: 'ES',
    roundingMode: 'line',
    reverseChargeTexts: {
      services: 'vat.reverseCharge.intraEU',
      goods: 'vat.reverseCharge.intraEU',
    },
  },

  identifiers: {
    types: [
      { id: 'nif', labelKey: 'identifier.nif', format: '^[A-Z]{1}[0-9]{7}[A-Z0-9]?$|^[XYZ]\\d{7}[A-Z0-9]?$', required: true },
      { id: 'cif', labelKey: 'identifier.cif', format: '^[A-HJNPQRSUVW][0-9]{7}[0-9A-J]$', required: false },
      { id: 'nie', labelKey: 'identifier.nie', format: '^[XYZ]\\d{7}[A-Z0-9]?$', required: false },
    ],
    formats: {
      nif: { format: '{country}{nif}' },
    },
  },

  transmission: {
    b2b: { model: 'verifactu', mandatory: true },
    b2g: { model: 'faceb2b', mandatory: true },
    b2c: { model: 'email', mandatory: false },
    crossBorder: {},
    exportDefault: 'peppol',
  },

  numbering: {
    prefix: '',
    format: '{type}{year}{number::6}',
    resetPeriod: 'annual',
    seriesRequired: false,
  },

  format: {
    syntax: 'facturae',
    version: '3.2.2',
    profile: 'standard',
  },

  signature: {
    type: 'xades',
    algorithm: 'SHA256',
    required: true,
  },

  qrCode: {
    content: '{qrData}',
    format: 'qr',
    position: 'header',
    required: true,
  },

  clearance: {
    endpoint: 'https://webservice-test.aeat.es',
    auth: 'certificate',
    idReturned: 'signatureId',
  },

  documents: ES_DOCUMENT_CONFIG,

  requiredFields: {
    invoice: ['clientId', 'items', 'nif', 'series'],
    client: ['name', 'nif', 'address', 'postalCode', 'city', 'country'],
  },

  legalMentions: {
    mandatory: [
      'legal.spain.mandatory.1',
      'legal.spain.mandatory.2',
    ],
    conditional: [
      {
        condition: { type: 'supplier', property: 'exemptVat' },
        textKey: 'legal.spain.exemption',
      },
    ],
  },

  customFields: [],
};
