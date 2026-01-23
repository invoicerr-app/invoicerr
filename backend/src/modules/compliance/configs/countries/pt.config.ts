import { CountryConfig } from '../../interfaces';

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
      { code: 'R1', rate: 13, labelKey: 'vat.reduced1', category: 'AA' },
      { code: 'R2', rate: 6, labelKey: 'vat.reduced2', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 23,
    exemptions: [
      {
        code: 'ISENTO_ART53',
        article: 'Artigo 53.º do CIVA',
        labelKey: 'compliance.pt.exemption.art53',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^PT[0-9]{9}$',
    numberPrefix: 'PT',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.pt.reverseCharge.services',
      goods: 'compliance.pt.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'nif',
        labelKey: 'identifiers.pt.nif',
        format: '^[0-9]{9}$',
        example: '123456789',
        required: true,
        maxLength: 9,
        luhnCheck: true,
      },
    ],
    client: [
      {
        id: 'nif',
        labelKey: 'identifiers.pt.nif',
        format: '^[0-9]{9}$',
        example: '123456789',
        required: false,
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'hash_chain',
      platform: 'saft',
      labelKey: 'transmission.saft',
      icon: 'file-code',
      mandatory: true,
      async: false,
    },
    b2g: {
      model: 'hash_chain',
      platform: 'saft',
      labelKey: 'transmission.saft',
      icon: 'building-2',
      mandatory: true,
      async: false,
    },
    b2c: {
      model: 'hash_chain',
      platform: 'saft',
      labelKey: 'transmission.saft',
      icon: 'file-code',
      mandatory: true,
      async: false,
    },
  },

  numbering: {
    seriesRequired: true,
    seriesRegistration: true,
    seriesFormat: '^[A-Z0-9]{1,35}$',
    hashChaining: true,
    hashAlgorithm: 'SHA-1',
    hashFields: ['invoiceDate', 'systemEntryDate', 'invoiceNumber', 'grossTotal', 'previousHash'],
    gapAllowed: false,
    resetPeriod: 'never',
    platformAssigned: false,
  },

  format: {
    preferred: 'saft',
    supported: ['pdf', 'saft', 'ubl'],
    syntax: 'UBL',
    version: '1.04',
    profile: 'SAF-T PT',
  },

  signature: {
    required: true,
    type: 'hash_chain',
    algorithm: 'RSA-SHA1',
    certificateType: 'qualified',
  },

  qrCode: {
    required: true,
    contentType: 'hash',
    contentFields: ['nif', 'nifClient', 'country', 'docType', 'docStatus', 'docDate', 'docNumber', 'atcud', 'taxableBase', 'vatAmount', 'grossTotal', 'hash'],
    format: 'qr',
    position: 'bottom-right',
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: [
      { code: 'NC', labelKey: 'correction.pt.notaCredito' },
      { code: 'ND', labelKey: 'correction.pt.notaDebito' },
    ],
  },

  archiving: {
    retentionYears: 12,
    formatRequired: 'original',
    searchable: true,
    dataResidency: 'PT',
  },

  clearance: {
    enabled: false,
    platform: 'at',
    authMethod: 'certificate',
    responseType: 'sync',
    assignsInvoiceNumber: false,
  },

  peppol: {
    enabled: true,
    schemeId: '9859',
    participantIdFormat: '9859:{nif}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    fiveCorner: false,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate', 'series', 'atcud'],
    client: ['name', 'address', 'city', 'postalCode', 'country'],
  },

  legalMentions: {
    mandatory: [
      'compliance.pt.mention.nif',
      'compliance.pt.mention.atcud',
      'compliance.pt.mention.softwareCertificado',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.pt.mention.isento',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.pt.mention.intraEU',
      },
    ],
  },

  customFields: [
    {
      id: 'series',
      labelKey: 'customFields.pt.series',
      type: 'string',
      required: true,
      format: '^[A-Z0-9]{1,35}$',
      mappedTo: 'saft.serie',
    },
    {
      id: 'atcud',
      labelKey: 'customFields.pt.atcud',
      type: 'string',
      required: true,
      format: '^[A-Z0-9]{8}-[0-9]+$',
      mappedTo: 'saft.atcud',
    },
  ],
};
