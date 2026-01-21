import { CountryConfig } from '../interfaces';

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
    reverseChargeTextKey: 'compliance.reverseCharge.generic',
  },

  identifiers: {
    company: [],
    client: [],
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate'],
    client: ['name', 'email'],
  },

  transmission: {
    b2b: {
      method: 'email',
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
    },
    b2g: {
      method: 'email',
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
    },
  },
};
