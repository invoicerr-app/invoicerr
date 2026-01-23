import { CountryConfig } from '../../interfaces';

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
      { code: 'R1', rate: 10, labelKey: 'vat.reduced1', category: 'AA' },
      { code: 'R2', rate: 5, labelKey: 'vat.reduced2', category: 'AA' },
      { code: 'SR', rate: 4, labelKey: 'vat.superReduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 22,
    exemptions: [
      {
        code: 'REGIME_FORFETTARIO',
        article: 'Art. 1, c. 54-89, L. 190/2014',
        labelKey: 'compliance.it.exemption.forfettario',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'REGIME_MINIMI',
        article: 'Art. 27 DL 98/2011',
        labelKey: 'compliance.it.exemption.minimi',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^IT[0-9]{11}$',
    numberPrefix: 'IT',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.it.reverseCharge.services',
      goods: 'compliance.it.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'partitaIva',
        labelKey: 'identifiers.it.partitaIva',
        format: '^[0-9]{11}$',
        example: '12345678901',
        required: true,
        maxLength: 11,
        peppolScheme: '0211',
      },
      {
        id: 'codiceFiscale',
        labelKey: 'identifiers.it.codiceFiscale',
        format: '^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$|^[0-9]{11}$',
        example: 'RSSMRA85M01H501Z',
        required: true,
      },
      {
        id: 'rea',
        labelKey: 'identifiers.it.rea',
        format: '^[A-Z]{2}-[0-9]+$',
        example: 'RM-123456',
        required: false,
      },
    ],
    client: [
      {
        id: 'partitaIva',
        labelKey: 'identifiers.it.partitaIva',
        format: '^[0-9]{11}$',
        example: '12345678901',
        required: false,
        peppolScheme: '0211',
      },
      {
        id: 'codiceFiscale',
        labelKey: 'identifiers.it.codiceFiscale',
        format: '^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$|^[0-9]{11}$',
        example: 'RSSMRA85M01H501Z',
        required: false,
      },
      {
        id: 'codiceDestinatario',
        labelKey: 'identifiers.it.codiceDestinatario',
        format: '^[A-Z0-9]{7}$',
        example: 'ABC1234',
        required: false,
        maxLength: 7,
      },
      {
        id: 'pec',
        labelKey: 'identifiers.it.pec',
        format: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        example: 'azienda@pec.it',
        required: false,
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'clearance',
      platform: 'sdi',
      labelKey: 'transmission.sdi',
      icon: 'file-check',
      mandatory: true,
      async: true,
      deadlineDays: 12,
    },
    b2g: {
      model: 'clearance',
      platform: 'sdi',
      labelKey: 'transmission.sdi',
      icon: 'building-2',
      mandatory: true,
      async: true,
      deadlineDays: 12,
    },
    b2c: {
      model: 'clearance',
      platform: 'sdi',
      labelKey: 'transmission.sdi',
      icon: 'file-check',
      mandatory: true,
      async: true,
      deadlineDays: 12,
    },
  },

  numbering: {
    seriesRequired: false,
    seriesRegistration: false,
    hashChaining: false,
    gapAllowed: false,
    resetPeriod: 'yearly',
  },

  format: {
    preferred: 'fatturaPA',
    supported: ['fatturaPA'],
    syntax: 'FatturaPA',
    version: '1.2.2',
    profile: 'FPA12',
  },

  signature: {
    required: true,
    type: 'xades',
    algorithm: 'SHA-256',
    certificateType: 'qualified',
  },

  qrCode: {
    required: false,
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: [
      { code: 'TD04', labelKey: 'correction.it.notaDiCredito' },
      { code: 'TD05', labelKey: 'correction.it.notaDiDebito' },
    ],
  },

  archiving: {
    retentionYears: 10,
    formatRequired: 'original',
    searchable: true,
    dataResidency: 'IT',
    platformStoresCopy: true,
  },

  clearance: {
    enabled: true,
    platform: 'sdi',
    authMethod: 'certificate',
    submitEndpoint: 'https://ivaservizi.agenziaentrate.gov.it/ser/sdiws/FatturaElettronicaV1',
    responseType: 'async_poll',
    assignsInvoiceNumber: false,
    returnedIdField: 'identificativoSdI',
    buyerAcceptance: false,
    requiresMiddleware: false,
  },

  peppol: {
    enabled: true,
    schemeId: '0211',
    participantIdFormat: '0211:{partitaIva}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    fiveCorner: true,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate'],
    client: ['name', 'address', 'city', 'postalCode', 'country', 'codiceFiscale'],
  },

  legalMentions: {
    mandatory: [
      'compliance.it.mention.partitaIva',
      'compliance.it.mention.rea',
      'compliance.it.mention.capitalesociale',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.it.mention.regimeForfettario',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.it.mention.intraEU',
      },
    ],
  },

  customFields: [
    {
      id: 'codiceDestinatario',
      labelKey: 'customFields.it.codiceDestinatario',
      type: 'string',
      required: false,
      format: '^[A-Z0-9]{7}$',
      mappedTo: 'sdi.codiceDestinatario',
    },
    {
      id: 'pec',
      labelKey: 'customFields.it.pec',
      type: 'string',
      required: false,
      mappedTo: 'sdi.pecDestinatario',
    },
    {
      id: 'cup',
      labelKey: 'customFields.it.cup',
      type: 'string',
      required: false,
      format: '^[A-Z0-9]{15}$',
      mappedTo: 'sdi.codiceCUP',
    },
    {
      id: 'cig',
      labelKey: 'customFields.it.cig',
      type: 'string',
      required: false,
      format: '^[A-Z0-9]{10}$',
      mappedTo: 'sdi.codiceCIG',
    },
  ],
};
