import { CountryConfig, DEFAULT_DOCUMENT_CONFIG } from '../../interfaces';

/**
 * United States Configuration
 *
 * PERMISSIVE SYSTEM:
 * - No federal VAT (sales tax at state level, optional tracking)
 * - No sequential numbering requirement
 * - Invoices can be modified freely
 * - No mandatory e-invoicing
 * - No clearance model
 * - No digital signature requirement
 * - Email transmission is standard
 * - Gaps in numbering are allowed
 * - No mandatory archival format
 */
export const usConfig: CountryConfig = {
  code: 'US',
  name: 'country.unitedStates',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'America/New_York',
  isEU: false,

  vat: {
    rates: [
      // No federal VAT - these are placeholder rates for sales tax tracking
      { code: 'NONE', rate: 0, labelKey: 'vat.none', category: 'O' },
      // Common state sales tax rates (optional, user can add their state rate)
      { code: 'STATE', rate: 0, labelKey: 'vat.stateSalesTax', category: 'S' },
    ],
    defaultRate: 0,
    exemptions: [
      {
        code: 'EXEMPT',
        article: 'State Tax Exemption',
        labelKey: 'compliance.us.exemption.taxExempt',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'RESALE',
        article: 'Resale Certificate',
        labelKey: 'compliance.us.exemption.resale',
        ublCode: 'VATEX-EU-O',
      },
    ],
    // No standard format - EIN is for income tax, not VAT
    numberFormat: '^[0-9]{2}-[0-9]{7}$',
    numberPrefix: '',
    roundingMode: 'total',
    // Not applicable for US but required by interface
    reverseChargeTexts: {
      services: 'compliance.us.reverseCharge.services',
      goods: 'compliance.us.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'ein',
        labelKey: 'identifiers.us.ein',
        format: '^[0-9]{2}-[0-9]{7}$',
        example: '12-3456789',
        required: false, // Not required for invoicing
        maxLength: 10,
      },
      {
        id: 'duns',
        labelKey: 'identifiers.us.duns',
        format: '^[0-9]{9}$',
        example: '123456789',
        required: false,
        maxLength: 9,
      },
      {
        id: 'stateId',
        labelKey: 'identifiers.us.stateId',
        format: '^.*$',
        example: 'CA-12345678',
        required: false,
      },
    ],
    client: [
      {
        id: 'ein',
        labelKey: 'identifiers.us.ein',
        format: '^[0-9]{2}-[0-9]{7}$',
        example: '12-3456789',
        required: false,
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'post_audit',
      platform: 'email',
      platforms: [
        {
          id: 'email',
          labelKey: 'platform.email',
          icon: 'mail',
          isDefault: true,
          available: true,
        },
        {
          id: 'edi',
          labelKey: 'platform.edi',
          icon: 'file-code',
          available: true,
          descriptionKey: 'platform.edi.description',
        },
      ],
      labelKey: 'transmission.email',
      icon: 'mail',
      mandatory: false,
      async: false,
      userSelectable: true,
      emailFallback: true,
    },
    b2g: {
      model: 'post_audit',
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
      emailFallback: true,
    },
    b2c: {
      model: 'email',
      platform: 'email',
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
    gapAllowed: true, // ✅ PERMISSIVE: Gaps allowed
    resetPeriod: 'never', // User can choose
  },

  format: {
    preferred: 'pdf',
    supported: ['pdf', 'ubl'], // UBL optional for EDI
    syntax: 'PDF',
    version: '1.0',
    profile: 'Simple',
  },

  signature: {
    required: false, // ✅ PERMISSIVE: No signature required
    type: 'none',
  },

  qrCode: {
    required: false, // ✅ PERMISSIVE: No QR code required
  },

  correction: {
    allowDirectModification: true, // ✅ PERMISSIVE: Can modify invoices
    method: 'void_and_reissue',
    requiresOriginalReference: false, // ✅ PERMISSIVE: No reference required
    codes: [],
  },

  archiving: {
    retentionYears: 7, // IRS requirement for tax records
    formatRequired: 'any', // ✅ PERMISSIVE: Any format acceptable
    searchable: false,
    dataResidency: 'US',
  },

  requiredFields: {
    invoice: ['clientId', 'items'], // ✅ PERMISSIVE: Minimal required fields
    client: ['name'], // ✅ PERMISSIVE: Only name required
  },

  legalMentions: {
    mandatory: [], // ✅ PERMISSIVE: No mandatory legal mentions
    conditional: [],
  },

  customFields: [],

  documents: {
    ...DEFAULT_DOCUMENT_CONFIG,
    modification: {
      invoiceEditable: true, // ✅ PERMISSIVE: Invoices can be edited
      requiresCreditNote: false, // ✅ PERMISSIVE: No credit note required
      requiresNewInvoice: false,
      correctionCodesRequired: false,
      allowedCorrectionMethods: ['credit-note', 'amendment', 'cancellation'],
    },
  },
};
