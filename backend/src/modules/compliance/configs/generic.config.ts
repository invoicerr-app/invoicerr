import { CountryConfig } from '../interfaces';

/**
 * Generic configuration for unsupported countries
 * Used as fallback when no specific country config exists
 */
export const genericConfig: Omit<CountryConfig, 'code'> = {
  name: 'country.unknown',
  currency: 'EUR',
  locale: 'en-US',
  timezone: 'UTC',
  isEU: false,

  vat: {
    rates: [
      { code: 'S', rate: 20, labelKey: 'vat.standard', category: 'S' },
      { code: 'R', rate: 10, labelKey: 'vat.reduced', category: 'AA' },
      { code: 'Z', rate: 0, labelKey: 'vat.zero', category: 'Z' },
    ],
    defaultRate: 20,
    exemptions: [],
    numberFormat: '^[A-Z]{2}[0-9A-Z]+$',
    numberPrefix: '',
    roundingMode: 'total',
    reverseChargeTexts: {
      services: 'compliance.reverseCharge.services',
      goods: 'compliance.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [],
    client: [],
  },

  transmission: {
    b2b: {
      model: 'email',
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
      async: false,
    },
    b2g: {
      model: 'email',
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
      async: false,
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
    gapAllowed: true,
    resetPeriod: 'never',
  },

  format: {
    preferred: 'pdf',
    supported: ['pdf'],
    syntax: 'UBL',
  },

  signature: {
    required: false,
    type: 'none',
  },

  qrCode: {
    required: false,
  },

  correction: {
    allowDirectModification: true,
    method: 'credit_note',
    requiresOriginalReference: false,
  },

  archiving: {
    retentionYears: 7,
    dataResidency: 'any',
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate'],
    client: ['name', 'email'],
  },

  legalMentions: {
    mandatory: [],
    conditional: [],
  },
};
