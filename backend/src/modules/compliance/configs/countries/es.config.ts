import { CountryConfig } from '../../interfaces';

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
      { code: 'R', rate: 10, labelKey: 'vat.reduced', category: 'AA' },
      { code: 'SR', rate: 4, labelKey: 'vat.superReduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 21,
    exemptions: [
      {
        code: 'EXENTO_ART20',
        article: 'Art. 20 Ley IVA',
        labelKey: 'compliance.es.exemption.art20',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^ES[A-Z0-9][0-9]{7}[A-Z0-9]$',
    numberPrefix: 'ES',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.es.reverseCharge.services',
      goods: 'compliance.es.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'nif',
        labelKey: 'identifiers.es.nif',
        format: '^[A-Z0-9][0-9]{7}[A-Z0-9]$',
        required: true,
        maxLength: 9,
      },
      {
        id: 'cif',
        labelKey: 'identifiers.es.cif',
        format: '^[A-Z][0-9]{7}[A-Z0-9]$',
        required: false,
        maxLength: 9,
      },
    ],
    client: [
      {
        id: 'nif',
        labelKey: 'identifiers.es.nif',
        format: '^[A-Z0-9][0-9]{7}[A-Z0-9]$',
        required: false,
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'hash_chain',
      platform: 'verifactu',
      labelKey: 'transmission.verifactu',
      icon: 'link',
      mandatory: true,
      mandatoryFrom: '2025-07-01',
      async: false,
    },
    b2g: {
      model: 'clearance',
      platform: 'face',
      labelKey: 'transmission.face',
      icon: 'building-2',
      mandatory: true,
      async: true,
    },
    b2c: {
      model: 'hash_chain',
      platform: 'verifactu',
      labelKey: 'transmission.verifactu',
      icon: 'link',
      mandatory: true,
      mandatoryFrom: '2025-07-01',
      async: false,
    },
  },

  numbering: {
    seriesRequired: true,
    seriesRegistration: false,
    seriesFormat: '^[A-Z0-9]{1,4}$',
    hashChaining: true,
    hashAlgorithm: 'SHA-256',
    hashFields: ['invoiceNumber', 'issueDate', 'totalTTC', 'nif', 'previousHash'],
    gapAllowed: false,
    resetPeriod: 'yearly',
  },

  format: {
    preferred: 'facturae',
    supported: ['pdf', 'facturae', 'ubl'],
    syntax: 'Facturae',
    version: '3.2.2',
    profile: 'Facturae',
  },

  signature: {
    required: true,
    type: 'xades',
    algorithm: 'SHA-256',
    certificateType: 'qualified',
    timestampRequired: true,
  },

  qrCode: {
    required: true,
    contentType: 'hash',
    contentFields: ['nif', 'invoiceNumber', 'issueDate', 'totalTTC', 'hash'],
    format: 'qr',
    position: 'bottom-right',
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: [
      { code: 'R1', labelKey: 'correction.es.rectificativaArt80' },
      { code: 'R2', labelKey: 'correction.es.rectificativaArt80_2' },
      { code: 'R3', labelKey: 'correction.es.rectificativaArt80_3' },
      { code: 'R4', labelKey: 'correction.es.rectificativaOtros' },
    ],
  },

  archiving: {
    retentionYears: 6,
    formatRequired: 'original',
    searchable: true,
    dataResidency: 'ES',
  },

  clearance: {
    enabled: true,
    platform: 'verifactu',
    authMethod: 'certificate',
    submitEndpoint: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/verifactu/ws/SuministroLR.wsdl',
    responseType: 'sync',
    assignsInvoiceNumber: false,
    returnsQRCode: true,
  },

  peppol: {
    enabled: true,
    schemeId: '9920',
    participantIdFormat: '9920:ES{nif}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    fiveCorner: false,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate', 'series'],
    client: ['name', 'address', 'city', 'postalCode', 'country', 'nif'],
  },

  legalMentions: {
    mandatory: [
      'compliance.es.mention.nif',
      'compliance.es.mention.registroMercantil',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.es.mention.exento',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.es.mention.intraEU',
      },
    ],
  },

  customFields: [
    {
      id: 'series',
      labelKey: 'customFields.es.series',
      type: 'string',
      required: true,
      format: '^[A-Z0-9]{1,4}$',
      mappedTo: 'verifactu.serie',
    },
  ],
};
