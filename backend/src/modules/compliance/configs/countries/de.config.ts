import { CountryConfig } from '../../interfaces';

export const deConfig: CountryConfig = {
  code: 'DE',
  name: 'country.germany',
  currency: 'EUR',
  locale: 'de-DE',
  timezone: 'Europe/Berlin',
  isEU: true,
  euSince: '1958-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 19, labelKey: 'vat.standard', category: 'S' },
      { code: 'R', rate: 7, labelKey: 'vat.reduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 19,
    exemptions: [
      {
        code: 'KLEINUNTERNEHMER',
        article: '§ 19 UStG',
        labelKey: 'compliance.de.exemption.kleinunternehmer',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^DE[0-9]{9}$',
    numberPrefix: 'DE',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.de.reverseCharge.services',
      goods: 'compliance.de.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'steuernummer',
        labelKey: 'identifiers.de.steuernummer',
        format: '^[0-9]{10,13}$',
        example: '1234567890123',
        required: false,
      },
      {
        id: 'handelsregister',
        labelKey: 'identifiers.de.handelsregister',
        format: '^.*$',
        example: 'HRB 12345',
        required: false,
      },
      {
        id: 'leitwegId',
        labelKey: 'identifiers.de.leitwegId',
        format: '^[0-9]{2}-[0-9A-Z]+-[0-9A-Z]+$',
        example: '04-1234567890-12',
        required: false,
        peppolScheme: '0204',
      },
    ],
    client: [
      {
        id: 'leitwegId',
        labelKey: 'identifiers.de.leitwegId',
        format: '^[0-9]{2}-[0-9A-Z]+-[0-9A-Z]+$',
        example: '04-1234567890-12',
        required: false,
        peppolScheme: '0204',
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'peppol',
      platform: 'peppol',
      labelKey: 'transmission.peppol',
      icon: 'globe',
      mandatory: false,
      mandatoryFrom: '2025-01-01',
      async: true,
    },
    b2g: {
      model: 'peppol',
      platform: 'xrechnung',
      labelKey: 'transmission.xrechnung',
      icon: 'building-2',
      mandatory: true,
      async: true,
      deadlineDays: 30,
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
    preferred: 'xrechnung',
    supported: ['pdf', 'xrechnung', 'zugferd', 'ubl'],
    syntax: 'UBL',
    version: '3.0',
    profile: 'XRechnung',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
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
    ],
  },

  archiving: {
    retentionYears: 10,
    formatRequired: 'original',
    searchable: true,
    dataResidency: 'EU',
  },

  peppol: {
    enabled: true,
    schemeId: '0204',
    participantIdFormat: '0204:{leitwegId}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    localStandard: 'XRechnung',
    localVersion: '3.0',
    validatorUrl: 'https://www.portalteil.de/validator/',
    fiveCorner: false,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate'],
    client: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
  },

  legalMentions: {
    mandatory: [
      'compliance.de.mention.handelsregister',
      'compliance.de.mention.geschaeftsfuehrer',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.de.mention.kleinunternehmer',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.de.mention.intraEU',
      },
    ],
  },

  customFields: [
    {
      id: 'leitwegId',
      labelKey: 'customFields.de.leitwegId',
      type: 'string',
      required: false,
      format: '^[0-9]{2}-[0-9A-Z]+-[0-9A-Z]+$',
      mappedTo: 'xrechnung.buyerReference',
    },
    {
      id: 'bestellnummer',
      labelKey: 'customFields.de.bestellnummer',
      type: 'string',
      required: false,
      mappedTo: 'xrechnung.orderReference',
    },
  ],
};
