/**
 * Europe-national smaller portal specs — pure data, built via the shared generic-portal factory.
 *
 * Countries / portals:
 *   UA  (Ukraine)   — DPS ЄРПН (ua-dps)             ASYNC_POLL (clearance/blocking)
 *   ME  (Montenegro)— PU Fiscalization (me-fiscal)   NONE (real-time)
 *   HR  (Croatia)   — Fiskalizacija 2.0 CIS (hr-fiskalizacija) ASYNC_POLL
 *   AL  (Albania)   — CIS fiscalization (al-cis)     ASYNC_POLL
 *   LV  (Latvia)    — VID eAddress (lv-vid)          NONE (reporting from 2026)
 *   SK  (Slovakia)  — Finančná správa (sk-financnasprava) NONE (VAT reporting)
 *   RS  (Serbia)    — SEF (rs-sef)                   ASYNC_POLL (clearance)
 *   ES  (Spain)     — AEAT SII/Verifactu (es-aeat)   NONE (real-time reporting)
 *   GR  (Greece)    — AADE myDATA (gr-aade)          NONE (RTIR reporting)
 *   HU  (Hungary)   — NAV Online Számla (hu-nav)     NONE (RTIR reporting)
 *   RO  (Romania)   — ANAF SPV / e-Factura (anaf)    ASYNC_POLL — see anaf-transmission.ts for depth
 *
 * RO ANAF has a deeper dedicated provider (anaf-transmission.ts).
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format: "{companyId}|{submissionId}"
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';

export const EUROPE_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'invoiceId', 'submissionId', 'jir', 'index', 'ref'],
  statusFields: ['status', 'invoiceStatus', 'result'],
  statusFallback: 'PENDING',
  clearTokens: [
    'APPROVED',
    'CLEARED',
    'ACCEPTED',
    'VALID',
    'SUCCESS',
    'CONFIRMED',
    'REGISTERED',
    'SENT',
    'OK',
    'VERIFIED',
  ],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'DENIED', 'CANCELLED'],
};

export const EUROPE_PORTAL_SPECS: GenericPortalSpec[] = [
  // --- Ukraine — DPS ЄРПН (VAT invoice registration) ---
  {
    id: 'ua-dps',
    label: 'Ukraine DPS ЄРПН (Electronic VAT Invoice Register)',
    artifact: 'UA_TAXINVOICE',
    baseUrls: {
      test: 'https://cabinet.tax.gov.ua/api/test/v1',
      prod: 'https://cabinet.tax.gov.ua/api/v1',
    },
    authHint: 'DPS qualified e-signature (КЕП) via КНЕДП provider; IPN (ЄДРПОУ/ІПН) required',
    submitEndpoint: '/documents/submit',
    pollEndpoint: '/documents/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'DPS environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'ipn', label: 'IPN / ЄДРПОУ (8-10 digits)', required: true },
      { type: 'text', name: 'apiToken', label: 'DPS API token (КЕП session)', required: true, secret: true },
    ],
    isAsync: true, // ЄРПН has async blocking/unblocking flow
  },
  // --- Montenegro — PU Fiscalization (real-time IKOF/JIKR) ---
  {
    id: 'me-fiscal',
    label: 'Montenegro Porezna Uprava Fiscalization',
    artifact: 'ME_FISCAL',
    baseUrls: {
      test: 'https://efi-test.tax.gov.me/api/v1',
      prod: 'https://efi.tax.gov.me/api/v1',
    },
    authHint: 'PU fiscalization certificate (TCR code + RSA key pair from Porezna Uprava)',
    submitEndpoint: '/fiscalize/invoice',
    pollEndpoint: '/fiscalize/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'PU environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'pib',
        label: 'PIB (8 digits, tax identification number)',
        required: true,
        minLength: 8,
        maxLength: 8,
      },
      { type: 'text', name: 'tcrCode', label: 'TCR (Tax Cash Register) code', required: true },
      { type: 'text', name: 'apiToken', label: 'PU API token', required: true, secret: true },
    ],
    isAsync: false, // Montenegrin fiscalization is real-time (IKOF → JIKR)
  },
  // --- Croatia — Fiskalizacija 2.0 / e-Račun CIS ---
  {
    id: 'hr-fiskalizacija',
    label: 'Croatia Fiskalizacija 2.0 / e-Račun (CIS)',
    artifact: 'HR_ERACUN',
    baseUrls: {
      test: 'https://cis-test.porezna-uprava.hr/api/v2',
      prod: 'https://cis.porezna-uprava.hr/api/v2',
    },
    authHint: 'Hrvatska Porezna Uprava CIS — FINA qualified certificate (OIB registration)',
    submitEndpoint: '/eracun/submit',
    pollEndpoint: '/eracun/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'CIS environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'oib',
        label: 'OIB (11 digits, personal identification number)',
        required: true,
        minLength: 11,
        maxLength: 11,
      },
      {
        type: 'text',
        name: 'businessPremise',
        label: 'Business premise identifier (prostor)',
        required: true,
      },
      { type: 'text', name: 'apiToken', label: 'CIS API token', required: true, secret: true },
    ],
    isAsync: true, // e-Račun CIS has async acknowledgement (ZKI → JIR)
  },
  // --- Albania — CIS Fiscalization ---
  {
    id: 'al-cis',
    label: 'Albania CIS Fiscalization (Tatime)',
    artifact: 'AL_FISCALIZATION',
    baseUrls: {
      test: 'https://efiskalizimi-test.tatime.gov.al/api/v1',
      prod: 'https://efiskalizimi.tatime.gov.al/api/v1',
    },
    authHint: 'Albanian Tatime CIS — NIPT + RSA-2048 certificate from Tatime portal',
    submitEndpoint: '/fiscalize/invoice',
    pollEndpoint: '/fiscalize/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'CIS environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'nipt',
        label: 'NIPT (10 chars, Albanian taxpayer ID)',
        required: true,
        minLength: 10,
        maxLength: 10,
      },
      { type: 'text', name: 'apiToken', label: 'CIS API token', required: true, secret: true },
    ],
    isAsync: true, // Albanian CIS has async NSLF/NIVF flow
  },
  // --- Latvia — VID eAddress (reporting mandate from 2026) ---
  {
    id: 'lv-vid',
    label: 'Latvia VID e-invoice (eAddress / Peppol mandate)',
    artifact: 'EN16931_UBL',
    baseUrls: {
      test: 'https://eds-test.vid.gov.lv/api/v1',
      prod: 'https://eds.vid.gov.lv/api/v1',
    },
    authHint: 'VID EDS portal — PVN (taxpayer registration number) + API key',
    submitEndpoint: '/einvoice/submit',
    pollEndpoint: '/einvoice/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'VID environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'pvnNumber', label: 'PVN registration number', required: true },
      { type: 'text', name: 'apiToken', label: 'VID EDS API key', required: true, secret: true },
    ],
    isAsync: false, // VID is reporting / forwarding — no clearance loop
  },
  // --- Slovakia — Finančná správa (eInvoice from 2027) ---
  {
    id: 'sk-financnasprava',
    label: 'Slovakia Finančná správa e-invoice',
    artifact: 'EN16931_UBL',
    baseUrls: {
      test: 'https://api-test.financnasprava.sk/einvoice/v1',
      prod: 'https://api.financnasprava.sk/einvoice/v1',
    },
    authHint: 'Finančná správa portal — IČO (8-digit company ID) + API key from e-Dane portal',
    submitEndpoint: '/submit',
    pollEndpoint: '/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'Finančná správa environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'ico',
        label: 'IČO (8-digit company registration number)',
        required: true,
        minLength: 8,
        maxLength: 8,
      },
      { type: 'text', name: 'apiToken', label: 'Finančná správa API key', required: true, secret: true },
    ],
    isAsync: false, // Slovak system is reporting-style (planned 2027)
  },
  // --- Serbia — SEF (electronic invoicing system) ---
  {
    id: 'rs-sef',
    label: 'Serbia SEF (Sistem e-Faktura)',
    artifact: 'EN16931_UBL',
    baseUrls: {
      test: 'https://tefportal-test.mfin.gov.rs/api/v1',
      prod: 'https://efaktura.mfin.gov.rs/api/v1',
    },
    authHint: 'SEF portal — PIB (9-digit tax ID) + API key from SEF portal registration',
    submitEndpoint: '/invoices',
    pollEndpoint: '/invoices',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'SEF environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'pib',
        label: 'PIB (9-digit tax identification number)',
        required: true,
        minLength: 9,
        maxLength: 9,
      },
      { type: 'text', name: 'apiToken', label: 'SEF API key', required: true, secret: true },
    ],
    isAsync: true, // SEF has async acceptance by buyer flow
  },
  // --- Spain — AEAT SII / Verifactu (real-time reporting) ---
  {
    id: 'es-aeat',
    label: 'Spain AEAT SII / Verifactu',
    artifact: 'ES_FACTURAE',
    baseUrls: {
      // SII: Web service HTTPS endpoint (SOAP)
      test: 'https://prewww1.aeat.es/wlpl/SSII-FACT/ws/SiiFactB2BV1SOAP',
      prod: 'https://www1.aeat.es/wlpl/SSII-FACT/ws/SiiFactB2BV1SOAP',
    },
    authHint: 'AEAT SII — NIF + qualified certificate (FNMT / AEAT) for SOAP WS auth',
    submitEndpoint: '/submit',
    pollEndpoint: '/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'AEAT environment',
        required: true,
        options: [
          { label: 'Pre-production', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'nif', label: 'NIF (Spanish tax ID, e.g. A12345678)', required: true },
      {
        type: 'text',
        name: 'apiToken',
        label: 'AEAT API token / certificate hash',
        required: true,
        secret: true,
      },
    ],
    isAsync: false, // SII is near-real-time reporting (4 days for B2B)
  },
  // --- Greece — AADE myDATA (RTIR — near-real-time reporting) ---
  {
    id: 'gr-aade',
    label: 'Greece AADE myDATA (RTIR)',
    artifact: 'NATIONAL_XML', // myDATA uses a specific XML format (mydata:InvoicesDoc)
    baseUrls: {
      test: 'https://mydata-preprod.aade.gr/invoices',
      prod: 'https://mydata.aade.gr/invoices',
    },
    authHint: 'AADE myDATA — AFM (9-digit tax number) + Ocp-Apim-Subscription-Key from myDATA portal',
    submitEndpoint: '/SendInvoices',
    pollEndpoint: '/RequestMyIncome',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'AADE myDATA environment',
        required: true,
        options: [
          { label: 'Pre-production', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'afm',
        label: 'AFM (9-digit Greek tax number, no EL prefix)',
        required: true,
        minLength: 9,
        maxLength: 9,
      },
      { type: 'text', name: 'userId', label: 'myDATA user ID', required: true },
      {
        type: 'text',
        name: 'subscriptionKey',
        label: 'Ocp-Apim-Subscription-Key (myDATA portal)',
        required: true,
        secret: true,
      },
    ],
    isAsync: false, // myDATA is RTIR — fire-and-forget (mark set on acceptance)
  },
  // --- Hungary — NAV Online Számla v3 (RTIR) ---
  {
    id: 'hu-nav',
    label: 'Hungary NAV Online Számla v3 (RTIR)',
    artifact: 'NATIONAL_XML',
    baseUrls: {
      test: 'https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3',
      prod: 'https://api.onlineszamla.nav.gov.hu/invoiceService/v3',
    },
    authHint:
      'NAV Online Számla v3 — adószám (8-digit tax number) + API user/key from onlineszamla.nav.gov.hu',
    submitEndpoint: '/manageInvoice',
    pollEndpoint: '/queryInvoiceStatus',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'NAV environment',
        required: true,
        options: [
          { label: 'Test (sandbox)', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'adoszam',
        label: 'Adószám (8-digit Hungarian tax number)',
        required: true,
        minLength: 8,
        maxLength: 13,
      },
      { type: 'text', name: 'login', label: 'NAV Online Számla API login', required: true },
      {
        type: 'text',
        name: 'password',
        label: 'NAV Online Számla API password',
        required: true,
        secret: true,
      },
      {
        type: 'text',
        name: 'xmlSigningKey',
        label: 'XML signing key (signature key from NAV portal)',
        required: true,
        secret: true,
      },
      {
        type: 'text',
        name: 'exchangeKey',
        label: 'Exchange key (data encryption key from NAV portal)',
        required: true,
        secret: true,
      },
    ],
    isAsync: false, // NAV Online Számla is RTIR (real-time incoming reporting)
  },
];

// Static list for registry use (no credentials needed at the stub layer)
export const EUROPE_PORTAL_PROVIDERS = buildGenericPortalProviders(
  EUROPE_PORTAL_SPECS,
  EUROPE_PORTAL_HEURISTICS,
);
