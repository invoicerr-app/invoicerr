/**
 * Smaller Asia portal clients — scaffold, live-deferred.
 *
 * Countries: TW (Taiwan), KZ (Kazakhstan), PH (Philippines), TH (Thailand),
 *            NP (Nepal), BD (Bangladesh), PK (Pakistan), CN (China), VN (Vietnam).
 *
 * Each defines:
 *  - Typed base URLs (test + prod where documented).
 *  - A minimal HTTP port interface (injectable for testing).
 *  - A TransmissionProvider via the shared SmallPortalProvider factory.
 *
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format (all): "{companyId}|{submissionId}"
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';

// ---------------------------------------------------------------------------
// Shared helpers (mirroring the LATAM smaller-portals pattern)
// ---------------------------------------------------------------------------

const GP: ChannelType = 'GOV_PORTAL_API';

interface SmallAsiaPortalConfig {
  id: string;
  label: string;
  artifact: string; // DocumentSyntax required
  baseUrls: { test: string; prod: string };
  authHint: string;
  submitEndpoint: string;
  pollEndpoint: string;
  configFields: ChannelConfigSchema['fields'];
  /**
   * When true (default): clearance-style — async, poll for authorization.
   * When false: real-time/reporting — fire-and-forget, returns SENT.
   */
  isAsync?: boolean;
}

type SimpleHttpPort = {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
};

class SmallAsiaPortalClient {
  constructor(
    private readonly http: SimpleHttpPort,
    private readonly baseUrl: string,
    private readonly label: string,
  ) {}

  async submit(endpoint: string, body: unknown, token: string): Promise<{ id: string; raw: unknown }> {
    const resp = await this.http.post(`${this.baseUrl}${endpoint}`, body, { Authorization: `Bearer ${token}` });
    if (resp.status >= 400) throw new Error(`${this.label}: submission failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const id = (
      data['id'] ?? data['uuid'] ?? data['submissionId'] ?? data['refNo'] ??
      data['trackId'] ?? data['invoiceId'] ?? data['receiptNo'] ?? `tx-${Date.now()}`
    ) as string;
    return { id: String(id), raw: data };
  }

  async pollStatus(endpoint: string, id: string, token: string): Promise<{ status: string; raw: unknown }> {
    const resp = await this.http.get(`${this.baseUrl}${endpoint}/${encodeURIComponent(id)}`,
      { Authorization: `Bearer ${token}` });
    if (resp.status >= 400) throw new Error(`${this.label}: poll failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const status = (
      data['status'] ?? data['invoiceStatus'] ?? data['approvalStatus'] ??
      data['documentStatus'] ?? data['result'] ?? 'PENDING'
    ) as string;
    return { status: String(status), raw: data };
  }
}

type SomeStatus = 'CLEARED' | 'REJECTED' | 'PENDING';

function buildSmallAsiaProvider(spec: SmallAsiaPortalConfig, credentials?: ChannelCredentialsPort): TransmissionProvider {
  const stub: SimpleHttpPort = {
    post: async () => { throw new Error(`${spec.label} HTTP port not implemented — ${spec.authHint}`); },
    get: async () => { throw new Error(`${spec.label} HTTP port not implemented`); },
  };

  return {
    id: spec.id,
    channel: GP,
    feedback: spec.isAsync !== false ? 'ASYNC_POLL' : 'NONE',
    pollPolicy: spec.isAsync !== false
      ? { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' }
      : undefined,
    configSchema: { fields: spec.configFields },

    async transmit(
      artifacts: SignedArtifact[],
      ctx: TransactionContext,
      _plan: CompliancePlan,
      key: string,
      log: ComplianceLogger,
      resolvedConfig?: ResolvedChannelConfig,
    ): Promise<TransmissionResult> {
      if (!resolvedConfig) {
        return { channel: GP, status: 'SKIPPED', notes: [`${spec.id}: no resolved config`] };
      }
      const { config, environment } = resolvedConfig;
      const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
      const baseUrl = isTest ? spec.baseUrls.test : spec.baseUrls.prod;
      const token = (config.apiToken ?? config.token ?? config.accessToken ?? '') as string;

      const art = artifacts.find((a) => a.syntax === spec.artifact);
      if (!art) return { channel: GP, status: 'SKIPPED', notes: [`${spec.id}: no ${spec.artifact} artifact`] };
      const companyId = ctx.supplierCompanyId;
      if (!companyId) return { channel: GP, status: 'SKIPPED', notes: [`${spec.id}: no supplierCompanyId`] };

      const http: SimpleHttpPort = stub;
      try {
        const client = new SmallAsiaPortalClient(http, baseUrl, spec.label);
        const xmlStr = Buffer.isBuffer(art.bytes) ? art.bytes.toString('utf-8') : new TextDecoder().decode(art.bytes);
        log.info(`transmission/${spec.id}`, `submitting to ${spec.label} (key ${key})`);
        const result = await client.submit(spec.submitEndpoint, { document: xmlStr, idempotencyKey: key }, token);
        const ref = `${companyId}|${result.id}`;
        log.info(`transmission/${spec.id}`, `submitted → id ${result.id} (key ${key})`);
        if (spec.isAsync === false) {
          return { channel: GP, status: 'SENT', ref, notes: [`id: ${result.id}`] };
        }
        return { channel: GP, status: 'PENDING', ref, notes: [`id: ${result.id}`] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`transmission/${spec.id}`, `transmit failed: ${msg} (key ${key})`);
        return { channel: GP, status: 'REJECTED', notes: [`${spec.id}: ${msg}`] };
      }
    },

    poll: spec.isAsync !== false
      ? async function (ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
          const parts = ref.split('|');
          if (parts.length !== 2) return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: invalid ref`] };
          const [companyId, id] = parts;
          if (!credentials) {
            log.todo(`transmission/${spec.id}`, `poll ${id}`);
            return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: no credentials port`] };
          }
          try {
            const resolved = await credentials.resolveActive(companyId, spec.id);
            if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: credentials inactive`] };
            const { config, environment } = resolved;
            const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
            const baseUrl = isTest ? spec.baseUrls.test : spec.baseUrls.prod;
            const token = (config.apiToken ?? config.token ?? config.accessToken ?? '') as string;
            const http: SimpleHttpPort = stub;
            const client = new SmallAsiaPortalClient(http, baseUrl, spec.label);
            const resp = await client.pollStatus(spec.pollEndpoint, id, token);
            const status = mapGenericAsiaStatus(resp.status);
            return { channel: GP, status, ref, notes: [`${spec.id}: ${resp.status}`] };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`transmission/${spec.id}`, `poll failed: ${msg}`);
            return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: poll error: ${msg}`] };
          }
        }
      : undefined,
  };
}

/** Heuristic mapping of portal-specific status strings to TransmissionStatus. */
function mapGenericAsiaStatus(s: string): SomeStatus {
  const u = s.toUpperCase();
  const clearTokens = ['APPROVED', 'CLEARED', 'VALID', 'SUCCESS', 'ACCEPTED', 'AUTHORIZED', 'REGISTERED',
    'COMPLETED', 'COMMITTED', 'OK', 'PASSED', 'DELIVERED'];
  const rejectTokens = ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'CANCELLED', 'DENIED'];
  if (clearTokens.some((t) => u.includes(t))) return 'CLEARED';
  if (rejectTokens.some((t) => u.includes(t))) return 'REJECTED';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Taiwan — MoF eGUI / unified invoice (統一發票)
// ---------------------------------------------------------------------------
export const twMofConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'MoF environment', required: true,
      options: [{ label: 'Test (wwwtest)', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'appId', label: 'MoF APP ID', required: true },
    { type: 'text', name: 'apiToken', label: 'MoF API Key', required: true, secret: true },
    { type: 'text', name: 'taxId', label: 'Seller Tax ID (統一編號, 8 digits)', required: true },
  ],
  isAsync: true,
};

// ---------------------------------------------------------------------------
// Kazakhstan — IS ESF (Информационная система электронных счетов-фактур)
// ---------------------------------------------------------------------------
export const kzIsEsfConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'IS ESF environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'IS ESF session token (from X.509 auth)', required: true, secret: true },
    { type: 'text', name: 'bin', label: 'BIN (Бизнес-идентификационный номер, 12 digits)', required: true },
  ],
  isAsync: true,
};

// ---------------------------------------------------------------------------
// Philippines — BIR EIS (Electronic Invoicing System)
// ---------------------------------------------------------------------------
export const phBirConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'BIR EIS environment', required: true,
      options: [{ label: 'Sandbox', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'BIR EIS API Key', required: true, secret: true },
    { type: 'text', name: 'tin', label: 'Seller TIN (9-12 digits)', required: true },
  ],
  isAsync: false, // BIR EIS is real-time
};

// ---------------------------------------------------------------------------
// Thailand — RD e-Tax Invoice & e-Receipt
// ---------------------------------------------------------------------------
export const thRdConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'RD environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'RD Service Provider API key', required: true, secret: true },
    { type: 'text', name: 'tin', label: 'Seller TIN (Thai Tax ID, 13 digits)', required: true },
  ],
  isAsync: false, // Real-time/reporting
};

// ---------------------------------------------------------------------------
// Nepal — IRD CBMS (Central Billing Monitoring System)
// ---------------------------------------------------------------------------
export const npIrdConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'IRD environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'IRD CBMS API key', required: true, secret: true },
    { type: 'text', name: 'pan', label: 'PAN (Permanent Account Number, 9 digits)', required: true },
  ],
  isAsync: false,
};

// ---------------------------------------------------------------------------
// Bangladesh — NBR e-invoice
// ---------------------------------------------------------------------------
export const bdNbrConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'NBR environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'NBR API key', required: true, secret: true },
    { type: 'text', name: 'bin', label: 'BIN (9 digits)', required: true },
  ],
  isAsync: false,
};

// ---------------------------------------------------------------------------
// Pakistan — FBR XIR (XML Invoice Reporting)
// ---------------------------------------------------------------------------
export const pkFbrConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'FBR environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'FBR ESP API key', required: true, secret: true },
    { type: 'text', name: 'strn', label: 'STRN (Sales Tax Registration Number)', required: true },
  ],
  isAsync: false,
};

// ---------------------------------------------------------------------------
// China — STA Golden Tax IV (e-Fapiao)
// ---------------------------------------------------------------------------
export const cnStaConfig: SmallAsiaPortalConfig = {
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
      type: 'select', name: 'environment', label: 'STA environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'STA session token (from Tax Control Device)', required: true, secret: true },
    { type: 'text', name: 'nsrsbh', label: 'NSRSBH (纳税人识别号, 18 chars)', required: true },
  ],
  isAsync: true,
};

// ---------------------------------------------------------------------------
// Vietnam — GDT (Tổng cục Thuế) — TT78/Decree-123
// ---------------------------------------------------------------------------
export const vnGdtConfig: SmallAsiaPortalConfig = {
  id: 'vn-gdt',
  label: 'Vietnam GDT (Tổng cục Thuế) TT78',
  artifact: 'VN_TT78',
  baseUrls: {
    test: 'https://hoadondientu.gdt.gov.vn:30000/api/test',
    prod: 'https://hoadondientu.gdt.gov.vn:30000/api',
  },
  authHint: 'GDT e-invoice API username + password (from tax authority registration) or service provider (SINVOICE, VNPT, etc.)',
  submitEndpoint: '/HD/hoadondientu',
  pollEndpoint: '/HD/status',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'GDT environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'GDT/Provider Bearer token', required: true, secret: true },
    { type: 'text', name: 'mst', label: 'MST (Mã số thuế — Tax code, 10 or 13 digits)', required: true },
  ],
  isAsync: true,
};

// ---------------------------------------------------------------------------
// Factory: export TransmissionProvider instances
// ---------------------------------------------------------------------------

export function buildSmallAsiaProviders(credentials?: ChannelCredentialsPort): TransmissionProvider[] {
  return [
    buildSmallAsiaProvider(twMofConfig, credentials),
    buildSmallAsiaProvider(kzIsEsfConfig, credentials),
    buildSmallAsiaProvider(phBirConfig, credentials),
    buildSmallAsiaProvider(thRdConfig, credentials),
    buildSmallAsiaProvider(npIrdConfig, credentials),
    buildSmallAsiaProvider(bdNbrConfig, credentials),
    buildSmallAsiaProvider(pkFbrConfig, credentials),
    buildSmallAsiaProvider(cnStaConfig, credentials),
    buildSmallAsiaProvider(vnGdtConfig, credentials),
  ];
}

// Export a static list for registry use (no credentials needed at the stub layer)
export const SMALL_ASIA_PROVIDERS = buildSmallAsiaProviders();
