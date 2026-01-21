import { CountryConfig } from '../../interfaces';

export const frConfig: CountryConfig = {
  code: 'FR',
  currency: 'EUR',
  isEU: true,

  vat: {
    rates: [
      { code: 'S', rate: 20, label: 'vat.standard' },
      { code: 'R1', rate: 10, label: 'vat.reduced1' },
      { code: 'R2', rate: 5.5, label: 'vat.reduced2' },
      { code: 'SR', rate: 2.1, label: 'vat.superReduced' },
      { code: 'Z', rate: 0, label: 'vat.zero' },
    ],
    defaultRate: 20,
    exemptions: [
      {
        code: 'MICRO',
        article: 'Article 293 B du CGI',
        labelKey: 'compliance.fr.exemption.micro',
      },
      {
        code: 'FORMATION',
        article: 'Article 261-4-4° a du CGI',
        labelKey: 'compliance.fr.exemption.formation',
      },
    ],
    numberFormat: '^FR[0-9A-Z]{2}[0-9]{9}$',
    numberPrefix: 'FR',
    reverseChargeTextKey: 'compliance.fr.reverseCharge',
  },

  identifiers: {
    company: [
      {
        id: 'siret',
        labelKey: 'identifiers.siret',
        format: '^[0-9]{14}$',
        required: true,
      },
      {
        id: 'rcs',
        labelKey: 'identifiers.rcs',
        format: '^.*$', // Format libre pour RCS
        required: false,
      },
    ],
    client: [
      {
        id: 'siret',
        labelKey: 'identifiers.siret',
        format: '^[0-9]{14}$',
        required: false,
      },
    ],
  },

  requiredFields: {
    invoice: ['clientId', 'items', 'dueDate'],
    client: ['name', 'email', 'address', 'city', 'postalCode'],
  },

  transmission: {
    b2b: {
      method: 'platform',
      labelKey: 'transmission.pdp',
      icon: 'send',
      mandatory: false, // Will be mandatory in 2026
      platform: 'superpdp',
    },
    b2g: {
      method: 'platform',
      labelKey: 'transmission.chorus',
      icon: 'building-2',
      mandatory: true,
      platform: 'chorus',
    },
  },
};
