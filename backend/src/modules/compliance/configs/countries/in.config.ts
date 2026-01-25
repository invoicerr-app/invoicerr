import { CountryConfig, DocumentConfig } from '../../interfaces';

/**
 * India Document Configuration
 * Strict e-invoicing with mandatory IRN via IRP
 */
const IN_DOCUMENT_CONFIG: DocumentConfig = {
  builder: 'generic', // India uses JSON, not XML
  outputFormats: {
    invoice: ['pdf'],
    quote: ['pdf'],
    receipt: ['pdf'],
    'credit-note': ['pdf'],
    proforma: ['pdf'],
  },
  defaultFormat: 'pdf',
  modification: {
    invoiceEditable: false, // ❌ STRICT: Cannot edit after IRN generation
    requiresCreditNote: true, // ❌ STRICT: Must use credit note
    requiresNewInvoice: false,
    correctionCodesRequired: true, // ❌ STRICT: Correction codes required
    allowedCorrectionMethods: ['credit-note'],
  },
  requiredElements: {
    invoice: [
      'qrCode', // ❌ STRICT: QR code mandatory
      'vatBreakdown',
      'legalMentions',
      'dueDate',
      'supplierIdentifiers',
      'customerIdentifiers',
      'documentHash',
      'sequentialNumber',
    ],
    quote: ['validityDate', 'legalMentions'],
    receipt: ['originalInvoiceRef'],
    'credit-note': ['originalInvoiceRef', 'correctionCode', 'vatBreakdown'],
  },
  archiving: {
    retentionYears: 8,
    archivalFormat: 'pdf',
    signatureRequired: true, // ❌ STRICT: Digital signature required
    hashChainRequired: false,
  },
};

/**
 * India Configuration
 *
 * STRICT SYSTEM (GST e-Invoicing):
 * - IRN (Invoice Reference Number) mandatory via IRP clearance
 * - QR code mandatory on all invoices
 * - Digital signature mandatory
 * - Sequential numbering with no gaps
 * - Invoices cannot be modified after IRN generation
 * - Credit note required for any corrections
 * - Multiple mandatory identifiers (GSTIN, PAN)
 * - Complex GST rates (CGST, SGST, IGST)
 * - Real-time reporting to GST portal
 * - 24-hour deadline for e-invoice generation
 */
export const inConfig: CountryConfig = {
  code: 'IN',
  name: 'country.india',
  currency: 'INR',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  isEU: false,

  vat: {
    rates: [
      // GST rates
      { code: 'GST28', rate: 28, labelKey: 'vat.in.gst28', category: 'S' },
      { code: 'GST18', rate: 18, labelKey: 'vat.in.gst18', category: 'S' },
      { code: 'GST12', rate: 12, labelKey: 'vat.in.gst12', category: 'AA' },
      { code: 'GST5', rate: 5, labelKey: 'vat.in.gst5', category: 'AA' },
      { code: 'GST3', rate: 3, labelKey: 'vat.in.gst3', category: 'AA' },
      { code: 'GST0.25', rate: 0.25, labelKey: 'vat.in.gst025', category: 'AA' },
      { code: 'EXEMPT', rate: 0, labelKey: 'vat.in.exempt', category: 'E' },
      { code: 'NIL', rate: 0, labelKey: 'vat.in.nil', category: 'Z' },
    ],
    defaultRate: 18,
    exemptions: [
      {
        code: 'EXEMPT_SCHEDULE',
        article: 'Schedule III - Exempted Supplies',
        labelKey: 'compliance.in.exemption.schedule3',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'EXPORT',
        article: 'Zero-rated export supply',
        labelKey: 'compliance.in.exemption.export',
        ublCode: 'VATEX-EU-O',
      },
      {
        code: 'SEZ',
        article: 'Supply to SEZ',
        labelKey: 'compliance.in.exemption.sez',
        ublCode: 'VATEX-EU-O',
      },
    ],
    // GSTIN format: 2 state code + 10 PAN + 1 entity + 1 Z + 1 checksum
    numberFormat: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
    numberPrefix: 'IN',
    roundingMode: 'line', // ❌ STRICT: Line-level rounding for GST
    reverseChargeTexts: {
      services: 'compliance.in.reverseCharge.services',
      goods: 'compliance.in.reverseCharge.goods',
    },
  },

  identifiers: {
    company: [
      {
        id: 'gstin',
        labelKey: 'identifiers.in.gstin',
        format: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
        example: '29AABCU9603R1ZM',
        required: true, // ❌ STRICT: Mandatory
        maxLength: 15,
      },
      {
        id: 'pan',
        labelKey: 'identifiers.in.pan',
        format: '^[A-Z]{5}[0-9]{4}[A-Z]{1}$',
        example: 'AABCU9603R',
        required: true, // ❌ STRICT: Mandatory
        maxLength: 10,
      },
      {
        id: 'cin',
        labelKey: 'identifiers.in.cin',
        format: '^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$',
        example: 'U74999KA2010PTC053234',
        required: false,
        maxLength: 21,
      },
      {
        id: 'lut',
        labelKey: 'identifiers.in.lut',
        format: '^[A-Z0-9]+$',
        example: 'AD290720000001K',
        required: false, // Required for exports
      },
    ],
    client: [
      {
        id: 'gstin',
        labelKey: 'identifiers.in.gstin',
        format: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
        example: '29AABCU9603R1ZM',
        required: true, // ❌ STRICT: Mandatory for B2B
        maxLength: 15,
      },
      {
        id: 'pan',
        labelKey: 'identifiers.in.pan',
        format: '^[A-Z]{5}[0-9]{4}[A-Z]{1}$',
        example: 'AABCU9603R',
        required: false,
        maxLength: 10,
      },
    ],
  },

  transmission: {
    b2b: {
      model: 'clearance',
      platform: 'irp',
      platforms: [
        {
          id: 'irp',
          labelKey: 'platform.irp',
          icon: 'shield-check',
          isDefault: true,
          available: true,
          descriptionKey: 'platform.irp.description',
        },
        {
          id: 'irp-nic',
          labelKey: 'platform.irpNic',
          icon: 'server',
          available: true,
          descriptionKey: 'platform.irpNic.description',
        },
      ],
      labelKey: 'transmission.irp',
      icon: 'shield-check',
      mandatory: true, // ❌ STRICT: Mandatory
      async: true,
      deadlineDays: 1, // ❌ STRICT: 24-hour deadline
      userSelectable: false,
      emailFallback: false, // ❌ STRICT: No fallback allowed
    },
    b2g: {
      model: 'clearance',
      platform: 'irp',
      platforms: [
        {
          id: 'irp',
          labelKey: 'platform.irp',
          icon: 'shield-check',
          isDefault: true,
          available: true,
        },
      ],
      labelKey: 'transmission.irp',
      icon: 'building-2',
      mandatory: true, // ❌ STRICT: Mandatory
      async: true,
      deadlineDays: 1,
      userSelectable: false,
      emailFallback: false,
    },
    b2c: {
      model: 'clearance',
      platform: 'irp',
      platforms: [
        {
          id: 'irp',
          labelKey: 'platform.irp',
          icon: 'shield-check',
          isDefault: true,
          available: true,
        },
      ],
      labelKey: 'transmission.irp',
      icon: 'receipt',
      mandatory: true, // ❌ STRICT: Also mandatory for B2C above threshold
      mandatoryFrom: '2023-08-01',
      async: true,
      deadlineDays: 1,
      userSelectable: false,
      emailFallback: false,
    },
  },

  numbering: {
    seriesRequired: true, // ❌ STRICT: Series required
    seriesRegistration: false,
    seriesFormat: '^[A-Z0-9]{1,16}$',
    hashChaining: false,
    gapAllowed: false, // ❌ STRICT: No gaps allowed
    resetPeriod: 'yearly', // Financial year (April-March)
    platformAssigned: true, // IRN assigned by IRP
    platformIdField: 'irn',
    platformIdFormat: '^[a-f0-9]{64}$', // SHA-256 hash
  },

  format: {
    preferred: 'json',
    supported: ['pdf', 'json'],
    syntax: 'GST-JSON',
    version: '1.1',
    profile: 'e-Invoice',
  },

  signature: {
    required: true, // ❌ STRICT: Digital signature mandatory
    type: 'hash_chain',
    algorithm: 'SHA-256',
    certificateType: 'qualified',
  },

  qrCode: {
    required: true, // ❌ STRICT: QR code mandatory
    contentType: 'verification_url', // IRP returns signed QR with verification URL
    contentFields: ['gstin', 'irn', 'invoiceNumber', 'invoiceDate', 'totalTTC', 'lineCount', 'hsnCodes'],
    format: 'qr',
    position: 'top-right',
  },

  correction: {
    allowDirectModification: false, // ❌ STRICT: Cannot modify
    method: 'credit_note',
    requiresOriginalReference: true, // ❌ STRICT: Must reference original
    requiresPreApproval: false,
    codes: [
      { code: 'CDNR', labelKey: 'correction.in.creditDebitRegistered' },
      { code: 'CDNUR', labelKey: 'correction.in.creditDebitUnregistered' },
    ],
  },

  archiving: {
    retentionYears: 8, // ❌ STRICT: 8 years mandatory
    formatRequired: 'original',
    searchable: true,
    searchFields: ['irn', 'invoiceNumber', 'gstin', 'date', 'totalTTC'],
    dataResidency: 'IN',
    platformStoresCopy: true, // IRP stores a copy
  },

  clearance: {
    enabled: true,
    platform: 'irp',
    authMethod: 'oauth2',
    authEndpoint: 'https://einvoice1.gst.gov.in/eivital/v1.04/auth',
    submitEndpoint: 'https://einvoice1.gst.gov.in/eivital/v1.04/eInvoice/Generate',
    responseType: 'sync',
    assignsInvoiceNumber: false,
    returnedIdField: 'Irn',
    returnsQRCode: true,
    returnsValidationUrl: false,
    buyerAcceptance: false,
    requiresMiddleware: true, // Requires GSP (GST Suvidha Provider)
  },

  requiredFields: {
    invoice: [
      'clientId',
      'items',
      'dueDate',
      'issueDate',
      'series',
      'supplyType', // ❌ STRICT: B2B, B2C, SEZWP, SEZWOP, etc.
      'placeOfSupply', // ❌ STRICT: State code
    ],
    client: [
      'name',
      'address',
      'city',
      'postalCode', // PIN code
      'country',
      'gstin', // ❌ STRICT: GSTIN mandatory for B2B
      'stateCode', // ❌ STRICT: State code mandatory
    ],
    quote: ['clientId', 'items', 'validUntil'],
  },

  legalMentions: {
    mandatory: [
      'compliance.in.mention.gstin',
      'compliance.in.mention.pan',
      'compliance.in.mention.stateCode',
      'compliance.in.mention.irn', // ❌ STRICT: IRN must appear
      'compliance.in.mention.qrCode', // ❌ STRICT: QR code mention
    ],
    conditional: [
      {
        condition: 'company.exemptVat',
        textKey: 'compliance.in.mention.compositionScheme',
      },
      {
        condition: 'transaction.isExport',
        textKey: 'compliance.in.mention.export',
      },
      {
        condition: 'transaction.isSEZ',
        textKey: 'compliance.in.mention.sez',
      },
      {
        condition: 'transaction.reverseCharge',
        textKey: 'compliance.in.mention.reverseCharge',
      },
    ],
  },

  customFields: [
    {
      id: 'supplyType',
      labelKey: 'customFields.in.supplyType',
      type: 'select',
      required: true, // ❌ STRICT
      options: [
        { value: 'B2B', labelKey: 'customFields.in.supplyType.b2b' },
        { value: 'B2C', labelKey: 'customFields.in.supplyType.b2c' },
        { value: 'SEZWP', labelKey: 'customFields.in.supplyType.sezWithPayment' },
        { value: 'SEZWOP', labelKey: 'customFields.in.supplyType.sezWithoutPayment' },
        { value: 'EXPWP', labelKey: 'customFields.in.supplyType.exportWithPayment' },
        { value: 'EXPWOP', labelKey: 'customFields.in.supplyType.exportWithoutPayment' },
        { value: 'DEXP', labelKey: 'customFields.in.supplyType.deemedExport' },
      ],
      mappedTo: 'irp.supplyType',
    },
    {
      id: 'placeOfSupply',
      labelKey: 'customFields.in.placeOfSupply',
      type: 'select',
      required: true, // ❌ STRICT
      options: [
        { value: '01', labelKey: 'state.in.jammuKashmir' },
        { value: '02', labelKey: 'state.in.himachalPradesh' },
        { value: '03', labelKey: 'state.in.punjab' },
        { value: '04', labelKey: 'state.in.chandigarh' },
        { value: '05', labelKey: 'state.in.uttarakhand' },
        { value: '06', labelKey: 'state.in.haryana' },
        { value: '07', labelKey: 'state.in.delhi' },
        { value: '08', labelKey: 'state.in.rajasthan' },
        { value: '09', labelKey: 'state.in.uttarPradesh' },
        { value: '10', labelKey: 'state.in.bihar' },
        // ... more states would be added
        { value: '29', labelKey: 'state.in.karnataka' },
        { value: '36', labelKey: 'state.in.telangana' },
        { value: '37', labelKey: 'state.in.andhraPradesh' },
      ],
      mappedTo: 'irp.placeOfSupply',
    },
    {
      id: 'hsnCode',
      labelKey: 'customFields.in.hsnCode',
      type: 'string',
      required: true, // ❌ STRICT: HSN code mandatory
      format: '^[0-9]{4,8}$',
      mappedTo: 'irp.hsnCode',
    },
    {
      id: 'reverseCharge',
      labelKey: 'customFields.in.reverseCharge',
      type: 'boolean',
      required: true, // ❌ STRICT
      mappedTo: 'irp.reverseCharge',
    },
  ],

  documents: IN_DOCUMENT_CONFIG,
};
