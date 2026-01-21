import type { CountryConfig } from '../../interfaces';

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
    roundingMode: 'line', // France: per-line rounding (tax rule)
    reverseChargeTexts: {
      services: 'compliance.fr.reverseCharge.services', // "Autoliquidation - art. 283 CGI"
      goods: 'compliance.fr.reverseCharge.goods', // "Livraison intracommunautaire exonérée - art. 262 ter I CGI"
    },
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
        format: '^.*$', // Format libre
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

  documentFormat: {
    preferred: 'facturx',
    supported: ['pdf', 'facturx', 'ubl'],
    xmlSyntax: 'CII', // Factur-X utilise Cross-Industry Invoice (CII)
  },

  transmission: {
    b2b: {
      method: 'platform',
      labelKey: 'transmission.pdp',
      icon: 'send',
      mandatory: false, // Obligatoire en 2026
      mandatoryFrom: '2026-09-01',
      platform: 'superpdp',
      async: true,
      deadlineDays: 7, // Transmission deadline
    },
    b2g: {
      method: 'platform',
      labelKey: 'transmission.chorus',
      icon: 'building-2',
      mandatory: true,
      platform: 'chorus',
      async: true,
      deadlineDays: 10,
    },
  },

  numbering: {
    seriesRequired: false,
    seriesRegistration: false,
    hashChaining: false,
    gapAllowed: false, // No gaps in numbering
    resetPeriod: 'yearly', // Annual reset allowed
  },

  peppol: {
    enabled: true,
    schemeId: '0009', // SIRET
    participantIdPrefix: '0009:',
  },

  legalMentions: {
    mandatory: ['compliance.fr.mention.siret', 'compliance.fr.mention.rcs'],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.fr.mention.vatExempt', // "TVA non applicable, art. 293 B du CGI"
      },
    ],
  },
};
