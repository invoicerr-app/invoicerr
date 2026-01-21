import type { CountryConfig } from '../interfaces';

export const genericConfig: Omit<CountryConfig, 'code'> = {
  currency: 'EUR',
  isEU: false,

  vat: {
    rates: [
      { code: 'S', rate: 20, label: 'vat.standard' },
      { code: 'Z', rate: 0, label: 'vat.zero' },
    ],
    defaultRate: 20,
    exemptions: [],
    numberFormat: '^[A-Z]{2}[0-9A-Z]+$',
    numberPrefix: '',
    roundingMode: 'total', // Per-total rounding by default
    reverseChargeTexts: {
      services: 'compliance.reverseCharge.services',
      goods: 'compliance.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [],
    client: [],
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate'],
    client: ['name', 'email'],
  },

  documentFormat: {
    preferred: 'pdf',
    supported: ['pdf'],
    xmlSyntax: 'UBL',
  },

  transmission: {
    b2b: {
      method: 'email',
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
      async: false,
    },
    b2g: {
      method: 'email',
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

  legalMentions: {
    mandatory: [],
    conditional: [],
  },
};
