import { CountryConfig, EU_DOCUMENT_CONFIG } from '../../interfaces';

export const beConfig: CountryConfig = {
  code: 'BE',
  name: 'country.belgium',
  currency: 'EUR',
  locale: 'fr-BE',
  timezone: 'Europe/Brussels',
  isEU: true,
  euSince: '1958-01-01',

  vat: {
    rates: [
      { code: 'S', rate: 21, labelKey: 'vat.standard', category: 'S' },
      { code: 'R1', rate: 12, labelKey: 'vat.reduced1', category: 'AA' },
      { code: 'R2', rate: 6, labelKey: 'vat.reduced2', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 21,
    exemptions: [
      {
        code: 'FRANCHISE',
        article: 'Article 56bis du Code TVA',
        labelKey: 'compliance.be.exemption.franchise',
        ublCode: 'VATEX-EU-O',
      },
    ],
    numberFormat: '^BE[0-9]{10}$',
    numberPrefix: 'BE',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.be.reverseCharge.services',
      goods: 'compliance.be.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'enterpriseNumber',
        labelKey: 'identifiers.be.enterpriseNumber',
        format: '^[0-9]{10}$',
        example: '0123456789',
        required: true,
        maxLength: 10,
        peppolScheme: '0208',
      },
      {
        id: 'kbo',
        labelKey: 'identifiers.be.kbo',
        format: '^[0-9]{4}\\.[0-9]{3}\\.[0-9]{3}$',
        example: '0123.456.789',
        required: false,
      },
    ],
    client: [
      {
        id: 'enterpriseNumber',
        labelKey: 'identifiers.be.enterpriseNumber',
        format: '^[0-9]{10}$',
        example: '0123456789',
        required: false,
        peppolScheme: '0208',
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'peppol',
      labelKey: 'transmission.peppol',
      icon: 'globe',
      mandatory: true,
      mandatoryFrom: '2026-01-01',
      async: true,
    },
    b2g: {
      model: 'peppol',
      labelKey: 'transmission.peppol',
      icon: 'building-2',
      mandatory: true,
      async: true,
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
    preferred: 'ubl',
    supported: ['pdf', 'ubl', 'peppol-bis'],
    syntax: 'UBL',
    version: '2.1',
    profile: 'PEPPOL-BIS',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
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
    retentionYears: 7,
    formatRequired: 'original',
    dataResidency: 'EU',
  },

  peppol: {
    enabled: true,
    schemeId: '0208',
    participantIdFormat: '0208:{enterpriseNumber}',
    documentTypeId: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
    processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    fiveCorner: false,
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate', 'issueDate'],
    client: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
  },

  legalMentions: {
    mandatory: [
      'compliance.be.mention.enterpriseNumber',
      'compliance.be.mention.bankAccount',
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.be.mention.franchise',
      },
      {
        condition: 'transaction.isIntraEU',
        textKey: 'compliance.be.mention.intraEU',
      },
    ],
  },

  paymentReference: {
    system: 'ogm-vcs',
    format: '^\\+\\+\\+[0-9]{3}/[0-9]{4}/[0-9]{5}\\+\\+\\+$',
    generator: 'generateBelgianOGM',
    labelKey: 'payment.be.ogm',
  },

  customFields: [],

  documents: EU_DOCUMENT_CONFIG,
};
