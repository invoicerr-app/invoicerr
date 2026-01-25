import { CountryConfig, EU_DOCUMENT_CONFIG } from '../../interfaces';

export const plConfig: CountryConfig = {
  code: 'PL',
  name: 'country.poland',
  currency: 'PLN',
  locale: 'pl-PL',
  timezone: 'Europe/Warsaw',
  isEU: true,
  euSince: '2004-05-01',

  vat: {
    rates: [
      { code: 'S', rate: 23, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 8, labelKey: 'vat.reduced1', category: 'AA' },
      { code: 'R2', rate: 5, labelKey: 'vat.reduced2', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 23,
    exemptions: [
      {
        code: 'ART113',
        article: 'Art. 113 ust. 1 ustawy o VAT',
        labelKey: 'compliance.pl.exemption.art113',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'ART43',
        article: 'Art. 43 ustawy o VAT',
        labelKey: 'compliance.pl.exemption.art43',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^PL[0-9]{10}$',
    numberPrefix: 'PL',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.pl.reverseCharge.services',
      goods: 'compliance.pl.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'nip',
        labelKey: 'identifiers.pl.nip',
        format: '^[0-9]{10}$',
        example: '1234567890',
        required: true,
        maxLength: 10,
        peppolScheme: '9945',
      },
      {
        id: 'regon',
        labelKey: 'identifiers.pl.regon',
        format: '^[0-9]{9}([0-9]{5})?$',
        example: '123456789',
        required: false,
        maxLength: 14,
      },
      {
        id: 'krs',
        labelKey: 'identifiers.pl.krs',
        format: '^[0-9]{10}$',
        example: '0000123456',
        required: false,
        maxLength: 10,
      },
    ],
    client: [
      {
        id: 'nip',
        labelKey: 'identifiers.pl.nip',
        format: '^[0-9]{10}$',
        example: '1234567890',
        required: false,
        maxLength: 10,
        peppolScheme: '9945',
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'clearance',
      platform: 'ksef',
      platforms: [
        {
          id: 'ksef',
          labelKey: 'platform.ksef',
          icon: 'shield-check',
          isDefault: true,
          available: true,
          descriptionKey: 'platform.ksef.description',
        },
      ],
      labelKey: 'transmission.ksef',
      icon: 'shield-check',
      mandatory: false,
      mandatoryFrom: '2026-07-01',
      async: true,
      deadlineDays: 1,
      userSelectable: false,
      emailFallback: false,
    },
    b2g: {
      model: 'clearance',
      platform: 'ksef',
      platforms: [
        {
          id: 'ksef',
          labelKey: 'platform.ksef',
          icon: 'shield-check',
          isDefault: true,
          available: true,
          descriptionKey: 'platform.ksef.description',
        },
      ],
      labelKey: 'transmission.ksef',
      icon: 'shield-check',
      mandatory: false,
      mandatoryFrom: '2026-07-01',
      async: true,
      deadlineDays: 1,
      userSelectable: false,
      emailFallback: false,
    },
    b2c: {
      model: 'email',
      platform: 'email',
      platforms: [
        {
          id: 'email',
          labelKey: 'platform.email',
          icon: 'mail',
          isDefault: true,
          available: true,
        },
      ],
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
      async: false,
      userSelectable: false,
      emailFallback: false,
    },
    crossBorder: {
      IT: 'sdi',
    },
    exportDefault: 'email',
  },

  numbering: {
    seriesRequired: false,
    seriesRegistration: false,
    hashChaining: false,
    gapAllowed: false,
    resetPeriod: 'yearly',
  },

  format: {
    preferred: 'ksef',
    supported: ['pdf', 'ksef', 'ubl', 'facturx'],
    syntax: 'FA3',
    version: '2',
    profile: 'KSeF',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:ksef.mf.gov.pl:fa:2',
    profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
  },

  signature: {
    required: true,
    type: 'platform_sign',
    certificateType: 'qualified',
    timestampRequired: true,
  },

  qrCode: {
    required: true,
    contentType: 'verification_url',
    format: 'qr',
    position: 'top-right',
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: [
      { code: '381', labelKey: 'correction.creditNote', ublTypeCode: '381' },
      { code: 'KOR', labelKey: 'correction.pl.korygujaca', ublTypeCode: '384' },
    ],
  },

  archiving: {
    retentionYears: 5,
    formatRequired: 'original',
    searchable: true,
    searchFields: ['invoiceNumber', 'clientName', 'date', 'nip', 'ksefNumber'],
    dataResidency: 'EU',
  },

  clearance: {
    enabled: true,
    platform: 'ksef',
    authMethod: 'certificate',
    authEndpoint: 'https://ksef.mf.gov.pl/api/auth/login',
    submitEndpoint: 'https://ksef.mf.gov.pl/api/online/Invoice/Send',
    responseType: 'async_poll',
    pollingEndpoint: 'https://ksef.mf.gov.pl/api/online/Invoice/Status/{sessionId}',
    assignsInvoiceNumber: true,
    returnsValidationUrl: true,
    buyerAcceptance: false,
    acceptanceTimeout: 0,
    autoAccept: true,
  },

  peppol: {
    enabled: true,
    schemeId: '9945',
    participantIdFormat: '9945:{nip}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    localStandard: 'KSeF',
    localVersion: 'FA(2)',
    validatorUrl: 'https://ksef.mf.gov.pl/web/validator',
    fiveCorner: false,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate', 'nip'],
    client: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
    quote: ['clientId', 'items', 'validUntil'],
  },

  legalMentions: {
    mandatory: [
      'compliance.pl.mention.nip',
      'compliance.pl.mention.regon',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.pl.mention.vatExempt',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.pl.mention.intraEU',
      },
      {
        condition: 'invoice.isKsefTransmitted',
        textKey: 'compliance.pl.mention.ksefNumber',
      },
    ],
  },

  customFields: [
    {
      id: 'ksefNumber',
      labelKey: 'customFields.pl.ksefNumber',
      type: 'string',
      required: false,
      format: '^[0-9]{10}-[0-9]{2}-[0-9]{2}-[0-9A-F]{32}$',
      mappedTo: 'ksef.numerKsef',
    },
    {
      id: 'pkd',
      labelKey: 'customFields.pl.pkd',
      type: 'string',
      required: false,
      format: '^[0-9]{2}\\.[0-9]{2}\\.[A-Z]$',
      mappedTo: 'ksef.pkd',
    },
  ],

  documents: EU_DOCUMENT_CONFIG,
};
