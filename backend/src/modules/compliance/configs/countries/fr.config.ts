import { CountryConfig } from '../../interfaces';

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
      { code: 'R1', rate: 10, labelKey: 'vat.reduced1', category: 'AA' },
      { code: 'R2', rate: 5.5, labelKey: 'vat.reduced2', category: 'AA' },
      { code: 'SR', rate: 2.1, labelKey: 'vat.superReduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 20,
    exemptions: [
      {
        code: 'MICRO',
        article: 'Article 293 B du CGI',
        labelKey: 'compliance.fr.exemption.micro',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'FORMATION',
        article: 'Article 261-4-4° a du CGI',
        labelKey: 'compliance.fr.exemption.formation',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^FR[0-9A-Z]{2}[0-9]{9}$',
    numberPrefix: 'FR',
    roundingMode: 'line',
    reverseChargeTexts: {
      services: 'compliance.fr.reverseCharge.services',
      goods: 'compliance.fr.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'siret',
        labelKey: 'identifiers.fr.siret',
        format: '^[0-9]{14}$',
        example: '12345678901234',
        required: true,
        maxLength: 14,
        luhnCheck: true,
        peppolScheme: '0009',
      },
      {
        id: 'siren',
        labelKey: 'identifiers.fr.siren',
        format: '^[0-9]{9}$',
        example: '123456789',
        required: false,
        maxLength: 9,
        luhnCheck: true,
      },
      {
        id: 'rcs',
        labelKey: 'identifiers.fr.rcs',
        format: '^.*$',
        example: 'RCS Paris B 123 456 789',
        required: false,
      },
      {
        id: 'naf',
        labelKey: 'identifiers.fr.naf',
        format: '^[0-9]{4}[A-Z]$',
        example: '6201Z',
        required: false,
        maxLength: 5,
      },
    ],
    client: [
      {
        id: 'siret',
        labelKey: 'identifiers.fr.siret',
        format: '^[0-9]{14}$',
        example: '12345678901234',
        required: false,
        maxLength: 14,
        luhnCheck: true,
        peppolScheme: '0009',
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'pdp',
      platform: 'superpdp',
      labelKey: 'transmission.pdp',
      icon: 'send',
      mandatory: false,
      mandatoryFrom: '2026-09-01',
      async: true,
      deadlineDays: 7,
    },
    b2g: {
      model: 'clearance',
      platform: 'chorus',
      labelKey: 'transmission.chorus',
      icon: 'building-2',
      mandatory: true,
      async: true,
      deadlineDays: 10,
    },
    b2c: {
      model: 'email',
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
      async: false,
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
    preferred: 'facturx',
    supported: ['pdf', 'facturx', 'ubl'],
    syntax: 'CII',
    version: '1.0',
    profile: 'EN16931',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:extended',
    profileId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
  },

  signature: {
    required: false,
    type: 'none',
  },

  qrCode: {
    required: false,
  },

  correction: {
    allowDirectModification: false,
    method: 'credit_note',
    requiresOriginalReference: true,
    codes: [
      { code: '381', labelKey: 'correction.creditNote', ublTypeCode: '381' },
      { code: '383', labelKey: 'correction.debitNote', ublTypeCode: '383' },
    ],
  },

  archiving: {
    retentionYears: 10,
    formatRequired: 'PDF/A-3',
    searchable: true,
    searchFields: ['invoiceNumber', 'clientName', 'date', 'totalTTC'],
    dataResidency: 'EU',
  },

  clearance: {
    enabled: true,
    platform: 'chorus',
    authMethod: 'oauth2',
    authEndpoint: 'https://chorus-pro.gouv.fr/oauth/token',
    submitEndpoint: 'https://chorus-pro.gouv.fr/api/v1/factures',
    responseType: 'async_poll',
    pollingEndpoint: 'https://chorus-pro.gouv.fr/api/v1/factures/{id}/status',
    assignsInvoiceNumber: false,
    returnsValidationUrl: true,
    buyerAcceptance: true,
    acceptanceTimeout: 30,
    autoAccept: false,
  },

  peppol: {
    enabled: true,
    schemeId: '0009',
    participantIdFormat: '0009:{siret}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    localStandard: 'Factur-X',
    localVersion: '1.0',
    fiveCorner: false,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate'],
    client: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
    quote: ['clientId', 'items', 'validUntil'],
  },

  legalMentions: {
    mandatory: [
      'compliance.fr.mention.siret',
      'compliance.fr.mention.rcs',
      'compliance.fr.mention.capital',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.fr.mention.vatExempt',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.fr.mention.intraEU',
      },
    ],
  },

  customFields: [
    {
      id: 'serviceCode',
      labelKey: 'customFields.fr.serviceCode',
      type: 'string',
      required: false,
      format: '^[0-9]{1,10}$',
      mappedTo: 'chorus.codeService',
    },
    {
      id: 'engagementNumber',
      labelKey: 'customFields.fr.engagementNumber',
      type: 'string',
      required: false,
      mappedTo: 'chorus.numeroEngagement',
    },
  ],
};
