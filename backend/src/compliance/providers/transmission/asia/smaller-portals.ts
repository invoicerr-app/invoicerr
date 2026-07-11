/**
 * Smaller Asia portal specs — pure data, built via the shared generic-portal factory.
 *
 * Countries: TW (Taiwan), KZ (Kazakhstan), PH (Philippines), TH (Thailand),
 *            NP (Nepal), BD (Bangladesh), PK (Pakistan), CN (China), VN (Vietnam).
 *
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format (all): "{companyId}|{submissionId}"
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';

export const ASIA_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'submissionId', 'refNo', 'trackId', 'invoiceId', 'receiptNo'],
  statusFields: ['status', 'invoiceStatus', 'approvalStatus', 'documentStatus', 'result'],
  statusFallback: 'PENDING',
  clearTokens: [
    'APPROVED',
    'CLEARED',
    'VALID',
    'SUCCESS',
    'ACCEPTED',
    'AUTHORIZED',
    'REGISTERED',
    'COMPLETED',
    'COMMITTED',
    'OK',
    'PASSED',
    'DELIVERED',
  ],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'CANCELLED', 'DENIED'],
};

export const SMALL_ASIA_PORTAL_SPECS: GenericPortalSpec[] = [
  // --- Taiwan — MoF eGUI / unified invoice (統一發票) ---
  {
    id: 'tw-mof',
    label: 'Taiwan MoF eGUI (統一發票)',
    artifact: 'TW_EGUI',
    baseUrls: {
      test: 'https://wwwtest.einvoice.nat.gov.tw/BIZAPIVAN',
      prod: 'https://www.einvoice.nat.gov.tw/BIZAPIVAN',
    },
    authHint: 'MoF APP ID + API Key (申請加值服務介接)',
    submitEndpoint: '/invapp/InvApp',
    pollEndpoint: '/invapp/InvAppQuery',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'MoF environment',
        required: true,
        options: [
          { label: 'Test (wwwtest)', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'appId', label: 'MoF APP ID', required: true },
      { type: 'text', name: 'apiToken', label: 'MoF API Key', required: true, secret: true },
      { type: 'text', name: 'taxId', label: 'Seller Tax ID (統一編號, 8 digits)', required: true },
    ],
    isAsync: true,
  },
  // --- Kazakhstan — IS ESF (Информационная система электронных счетов-фактур) ---
  {
    id: 'kz-isesf',
    label: 'Kazakhstan IS ESF',
    artifact: 'KZ_ESF',
    baseUrls: {
      test: 'https://test.esf.gov.kz:8443/api',
      prod: 'https://esf.gov.kz:8443/api',
    },
    authHint: 'IS ESF login + password + X.509 token (ЭЦП КНЦ / Казахстанский национальный УЦ)',
    submitEndpoint: '/i/create-and-send',
    pollEndpoint: '/i/invoices',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'IS ESF environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'apiToken',
        label: 'IS ESF session token (from X.509 auth)',
        required: true,
        secret: true,
      },
      { type: 'text', name: 'bin', label: 'BIN (Бизнес-идентификационный номер, 12 digits)', required: true },
    ],
    isAsync: true,
  },
  // --- Philippines — BIR EIS (Electronic Invoicing System) ---
  {
    id: 'ph-bir',
    label: 'Philippines BIR EIS',
    artifact: 'PH_EIS',
    baseUrls: {
      // BIR EIS sandbox endpoint (Revenue Regulations 8-2022)
      test: 'https://eis-sandbox.bir.gov.ph/api/v1',
      prod: 'https://eis.bir.gov.ph/api/v1',
    },
    authHint: 'BIR EIS Taxpayer ID + API key (Revenue Regulations 8-2022)',
    submitEndpoint: '/invoices',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'BIR EIS environment',
        required: true,
        options: [
          { label: 'Sandbox', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'apiToken', label: 'BIR EIS API Key', required: true, secret: true },
      { type: 'text', name: 'tin', label: 'Seller TIN (9-12 digits)', required: true },
    ],
    isAsync: false, // BIR EIS is real-time
  },
  // --- Thailand — RD e-Tax Invoice & e-Receipt ---
  {
    id: 'th-rd',
    label: 'Thailand RD e-Tax Invoice',
    artifact: 'TH_ETAX',
    baseUrls: {
      test: 'https://etax-test.rd.go.th/api/v1',
      prod: 'https://etax.rd.go.th/api/v1',
    },
    authHint: 'RD Service Provider API key + digital signature (ETDA-certified)',
    submitEndpoint: '/invoices/submit',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'RD environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'apiToken', label: 'RD Service Provider API key', required: true, secret: true },
      { type: 'text', name: 'tin', label: 'Seller TIN (Thai Tax ID, 13 digits)', required: true },
    ],
    isAsync: false, // Real-time/reporting
  },
  // --- Nepal — IRD CBMS (Central Billing Monitoring System) ---
  {
    id: 'np-ird',
    label: 'Nepal IRD CBMS',
    artifact: 'NP_CBMS',
    baseUrls: {
      test: 'https://cbms-test.ird.gov.np/api/v1',
      prod: 'https://cbms.ird.gov.np/api/v1',
    },
    authHint: 'IRD CBMS fiscal device API key + PAN (Permanent Account Number)',
    submitEndpoint: '/billingDetails',
    pollEndpoint: '/billingDetails/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'IRD environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'apiToken', label: 'IRD CBMS API key', required: true, secret: true },
      { type: 'text', name: 'pan', label: 'PAN (Permanent Account Number, 9 digits)', required: true },
    ],
    isAsync: false,
  },
  // --- Bangladesh — NBR e-invoice ---
  {
    id: 'bd-nbr',
    label: 'Bangladesh NBR e-invoice',
    artifact: 'BD_NBR',
    baseUrls: {
      test: 'https://nbr-test.gov.bd/api/v1',
      prod: 'https://nbr.gov.bd/api/v1',
    },
    authHint: 'NBR e-invoice API key + BIN (Business Identification Number)',
    submitEndpoint: '/invoices',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'NBR environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'apiToken', label: 'NBR API key', required: true, secret: true },
      { type: 'text', name: 'bin', label: 'BIN (9 digits)', required: true },
    ],
    isAsync: false,
  },
  // --- Pakistan — FBR XIR (XML Invoice Reporting) ---
  {
    id: 'pk-fbr',
    label: 'Pakistan FBR XIR',
    artifact: 'PK_FBR',
    baseUrls: {
      test: 'https://esp.fbr.gov.pk/api/v1/test',
      prod: 'https://esp.fbr.gov.pk/api/v1',
    },
    authHint: 'FBR ESP (Electronic Sales & Invoice Portal) STRN + API key',
    submitEndpoint: '/invoices/report',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'FBR environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'apiToken', label: 'FBR ESP API key', required: true, secret: true },
      { type: 'text', name: 'strn', label: 'STRN (Sales Tax Registration Number)', required: true },
    ],
    isAsync: false,
  },
  // --- China — STA Golden Tax IV (e-Fapiao) ---
  {
    id: 'cn-sta',
    label: 'China STA (Golden Tax IV — 全面数字化电子发票)',
    artifact: 'CN_EFAPIAO',
    baseUrls: {
      // China Golden Tax IV portal (STA / 国家税务总局)
      test: 'https://test.invoice.chinatax.gov.cn/api/v4',
      prod: 'https://invoice.chinatax.gov.cn/api/v4',
    },
    authHint: 'STA Tax Control Device (税控设备) serial + enterprise key (数字证书)',
    submitEndpoint: '/fapiao/issue',
    pollEndpoint: '/fapiao/query',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'STA environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'apiToken',
        label: 'STA session token (from Tax Control Device)',
        required: true,
        secret: true,
      },
      { type: 'text', name: 'nsrsbh', label: 'NSRSBH (纳税人识别号, 18 chars)', required: true },
    ],
    isAsync: true,
  },
  // --- Vietnam — GDT (Tổng cục Thuế) — TT78/Decree-123 ---
  {
    id: 'vn-gdt',
    label: 'Vietnam GDT (Tổng cục Thuế) TT78',
    artifact: 'VN_TT78',
    baseUrls: {
      test: 'https://hoadondientu.gdt.gov.vn:30000/api/test',
      prod: 'https://hoadondientu.gdt.gov.vn:30000/api',
    },
    authHint:
      'GDT e-invoice API username + password (from tax authority registration) or service provider (SINVOICE, VNPT, etc.)',
    submitEndpoint: '/HD/hoadondientu',
    pollEndpoint: '/HD/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'GDT environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'apiToken', label: 'GDT/Provider Bearer token', required: true, secret: true },
      { type: 'text', name: 'mst', label: 'MST (Mã số thuế — Tax code, 10 or 13 digits)', required: true },
    ],
    isAsync: true,
  },
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_ASIA_PROVIDERS = buildGenericPortalProviders(
  SMALL_ASIA_PORTAL_SPECS,
  ASIA_PORTAL_HEURISTICS,
);
