/**
 * Smaller Africa portal clients — scaffold, live-deferred.
 *
 * Countries: GH (Ghana), RW (Rwanda), TZ (Tanzania), UG (Uganda),
 *            ZM (Zambia), ZW (Zimbabwe), CI (Côte d'Ivoire), BJ (Benin).
 *
 * Each defines:
 *  - Typed base URLs (test + prod where documented).
 *  - A minimal HTTP port interface (injectable for testing).
 *  - A client class with submit() and pollStatus() methods.
 *  - A TransmissionProvider implementation for national-portals.
 *
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format (all): "{companyId}|{submissionId}"
 *
 * Most African fiscal systems are real-time (device-driven) → feedback = NONE.
 * Rwanda EBM and Ghana eVAT support async poll → ASYNC_POLL.
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';

// ---------------------------------------------------------------------------
// Shared helpers (mirroring the LATAM/Asia smaller-portals pattern)
// ---------------------------------------------------------------------------

const GP: ChannelType = 'GOV_PORTAL_API';

interface SmallAfricaPortalConfig {
  id: string;
  label: string;
  artifact: string; // DocumentSyntax required
  baseUrls: { test: string; prod: string };
  authHint: string;
  submitEndpoint: string;
  pollEndpoint: string;
  configFields: ChannelConfigSchema['fields'];
  /**
   * When true (default): clearance/EBM-style — async, poll for authorization.
   * When false: real-time fiscal device — fire-and-forget, returns SENT.
   */
  isAsync?: boolean;
}

type SimpleHttpPort = {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
};

class SmallAfricaPortalClient {
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
      data['id'] ?? data['uuid'] ?? data['submissionId'] ?? data['receiptNo'] ??
      data['verificationCode'] ?? data['fdnNo'] ?? data['invoiceNo'] ??
      data['smartInvoiceNo'] ?? data['mecefCode'] ?? `tx-${Date.now()}`
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
      data['result'] ?? data['ebmStatus'] ?? 'PENDING'
    ) as string;
    return { status: String(status), raw: data };
  }
}

type SomeStatus = 'CLEARED' | 'REJECTED' | 'PENDING';

function buildSmallAfricaProvider(spec: SmallAfricaPortalConfig, credentials?: ChannelCredentialsPort): TransmissionProvider {
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
        const client = new SmallAfricaPortalClient(http, baseUrl, spec.label);
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
            const client = new SmallAfricaPortalClient(http, baseUrl, spec.label);
            const resp = await client.pollStatus(spec.pollEndpoint, id, token);
            const status = mapGenericAfricaStatus(resp.status);
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
function mapGenericAfricaStatus(s: string): SomeStatus {
  const u = s.toUpperCase();
  const clearTokens = ['APPROVED', 'CLEARED', 'VALID', 'SUCCESS', 'ACCEPTED', 'CONFIRMED',
    'REGISTERED', 'COMPLETED', 'OK', 'GENERATED', 'VERIFIED', 'SIGNED'];
  const rejectTokens = ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'CANCELLED', 'DENIED'];
  if (clearTokens.some((t) => u.includes(t))) return 'CLEARED';
  if (rejectTokens.some((t) => u.includes(t))) return 'REJECTED';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Ghana — GRA E-VAT
// ---------------------------------------------------------------------------
export const ghGraConfig: SmallAfricaPortalConfig = {
  id: 'gh-gra',
  label: 'Ghana GRA E-VAT',
  artifact: 'GH_EVAT',
  baseUrls: {
    test: 'https://efacture-test.gra.gov.gh/api/v1',
    prod: 'https://efacture.gra.gov.gh/api/v1',
  },
  authHint: 'GRA E-VAT API key + taxpayer TIN (Ghana Revenue Authority)',
  submitEndpoint: '/invoices/submit',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'GRA environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'tin', label: 'GRA TIN (Ghana Taxpayer Identification Number)', required: true },
    { type: 'text', name: 'apiToken', label: 'GRA E-VAT API key', required: true, secret: true },
  ],
  isAsync: true, // GRA E-VAT has async clearance flow
};

// ---------------------------------------------------------------------------
// Rwanda — RRA EBM (Electronic Billing Machine)
// ---------------------------------------------------------------------------
export const rwRraConfig: SmallAfricaPortalConfig = {
  id: 'rw-rra',
  label: 'Rwanda RRA EBM (Electronic Billing Machine)',
  artifact: 'RW_EBM',
  baseUrls: {
    test: 'https://ebm.rra.gov.rw/api/test/v1',
    prod: 'https://ebm.rra.gov.rw/api/v1',
  },
  authHint: 'RRA EBM device serial + taxpayer TIN (Rwanda Revenue Authority)',
  submitEndpoint: '/invoices/save',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'RRA EBM environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'tin', label: 'RRA TIN (Rwanda TIN, 9 digits)', required: true },
    { type: 'text', name: 'deviceSerial', label: 'EBM Device Serial Number', required: true },
    { type: 'text', name: 'apiToken', label: 'RRA EBM API token', required: true, secret: true },
  ],
  isAsync: true, // EBM has async clearance
};

// ---------------------------------------------------------------------------
// Tanzania — TRA VFD (Virtual Fiscal Device)
// ---------------------------------------------------------------------------
export const tzTraConfig: SmallAfricaPortalConfig = {
  id: 'tz-tra',
  label: 'Tanzania TRA VFD (Virtual Fiscal Device)',
  artifact: 'TZ_VFD',
  baseUrls: {
    test: 'https://vfd.tra.go.tz/api/v1/test',
    prod: 'https://vfd.tra.go.tz/api/v1',
  },
  authHint: 'TRA VFD registration token + GCN (Global Certification Number) from TRA',
  submitEndpoint: '/receipts/submit',
  pollEndpoint: '/receipts/status',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'TRA VFD environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'gcn', label: 'GCN (Global Certification Number from TRA)', required: true },
    { type: 'text', name: 'tin', label: 'TIN (Tanzania TIN, 9 digits)', required: true },
    { type: 'text', name: 'apiToken', label: 'VFD registration token', required: true, secret: true },
  ],
  isAsync: false, // TRA VFD is real-time
};

// ---------------------------------------------------------------------------
// Uganda — URA EFRIS (Electronic Fiscal Receipting and Invoicing System)
// ---------------------------------------------------------------------------
export const ugUraConfig: SmallAfricaPortalConfig = {
  id: 'ug-ura',
  label: 'Uganda URA EFRIS',
  artifact: 'UG_EFRIS',
  baseUrls: {
    test: 'https://efris-test.ura.go.ug/efrisng/api/v3',
    prod: 'https://efris.ura.go.ug/efrisng/api/v3',
  },
  authHint: 'URA EFRIS device serial + TPIN (Taxpayer Identification Number, 10 digits)',
  submitEndpoint: '/business/saveInvoice',
  pollEndpoint: '/business/searchInvoice',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'URA EFRIS environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'tpin', label: 'TPIN (Uganda TIN, 10 digits)', required: true },
    { type: 'text', name: 'deviceNo', label: 'EFRIS Device Number', required: true },
    { type: 'text', name: 'apiToken', label: 'URA EFRIS API token', required: true, secret: true },
  ],
  isAsync: false, // EFRIS is real-time
};

// ---------------------------------------------------------------------------
// Zambia — ZRA Smart Invoice
// ---------------------------------------------------------------------------
export const zmZraConfig: SmallAfricaPortalConfig = {
  id: 'zm-zra',
  label: 'Zambia ZRA Smart Invoice',
  artifact: 'ZM_SMARTINVOICE',
  baseUrls: {
    test: 'https://smartinvoice-test.zra.org.zm/vsdc/api',
    prod: 'https://smartinvoice.zra.org.zm/vsdc/api',
  },
  authHint: 'ZRA Smart Invoice TPIN + device serial (Virtual Sales Data Controller)',
  submitEndpoint: '/saveinvoice',
  pollEndpoint: '/querySavedInvoice',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'ZRA Smart Invoice environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'tpin', label: 'TPIN (Zambia Tax Payer ID, 10 digits)', required: true },
    { type: 'text', name: 'deviceSerial', label: 'VSDC Device Serial Number', required: true },
    { type: 'text', name: 'apiToken', label: 'Smart Invoice API token', required: true, secret: true },
  ],
  isAsync: false, // ZRA Smart Invoice is real-time
};

// ---------------------------------------------------------------------------
// Zimbabwe — ZIMRA FDMS (Fiscal Day Management System)
// ---------------------------------------------------------------------------
export const zwZimraConfig: SmallAfricaPortalConfig = {
  id: 'zw-zimra',
  label: 'Zimbabwe ZIMRA FDMS (Fiscal Day Management System)',
  artifact: 'ZW_FDMS',
  baseUrls: {
    test: 'https://fdmsapitest.zimra.co.zw/api/v1',
    prod: 'https://fdmsapi.zimra.co.zw/api/v1',
  },
  authHint: 'ZIMRA FDMS device serial + BPNO (Business Partner Number) from ZIMRA portal',
  submitEndpoint: '/submitDocument',
  pollEndpoint: '/getDocumentStatus',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'ZIMRA FDMS environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'bpno', label: 'BPNO (Business Partner Number)', required: true },
    { type: 'text', name: 'deviceSerial', label: 'Fiscal Device Serial Number', required: true },
    { type: 'text', name: 'apiToken', label: 'FDMS API token', required: true, secret: true },
  ],
  isAsync: false, // FDMS is real-time
};

// ---------------------------------------------------------------------------
// Côte d'Ivoire — DGI FNE (Facture Normalisée Electronique)
// ---------------------------------------------------------------------------
export const ciDgiConfig: SmallAfricaPortalConfig = {
  id: 'ci-dgi',
  label: "Côte d'Ivoire DGI FNE (Facture Normalisée Electronique)",
  artifact: 'CI_FNE',
  baseUrls: {
    // FNE is part of the SIGF (Système Intégré de Gestion des Finances) platform
    test: 'https://sigf-test.dgi.gouv.ci/fne/api/v1',
    prod: 'https://sigf.dgi.gouv.ci/fne/api/v1',
  },
  authHint: 'DGI FNE API key + NCC (Numéro de Compte Contribuable) from DGI registration',
  submitEndpoint: '/factures/soumettre',
  pollEndpoint: '/factures/statut',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'DGI FNE environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'ncc', label: 'NCC (Numéro de Compte Contribuable)', required: true },
    { type: 'text', name: 'apiToken', label: 'DGI FNE API key', required: true, secret: true },
  ],
  isAsync: false, // FNE is real-time
};

// ---------------------------------------------------------------------------
// Benin — DGI MECeF / SeMeF (Machine Electronique de Contrôle et de Facturation)
// ---------------------------------------------------------------------------
export const bjDgiConfig: SmallAfricaPortalConfig = {
  id: 'bj-dgi',
  label: 'Benin DGI MECeF / SeMeF',
  artifact: 'BJ_MECEF',
  baseUrls: {
    // SeMeF (Système de Facturation Électronique et Monétique Fiscale)
    test: 'https://semef-test.impots.bj/api/v1',
    prod: 'https://semef.impots.bj/api/v1',
  },
  authHint: 'DGI MECeF IFU (Identifiant Fiscal Unique, 13 digits) + API key from DGI registration',
  submitEndpoint: '/factures/enregistrer',
  pollEndpoint: '/factures/statut',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'DGI MECeF environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'ifu', label: 'IFU (Identifiant Fiscal Unique, 13 digits)', required: true, minLength: 13, maxLength: 13 },
    { type: 'text', name: 'apiToken', label: 'MECeF/SeMeF API key', required: true, secret: true },
  ],
  isAsync: false, // MECeF is real-time
};

// ---------------------------------------------------------------------------
// Factory: export TransmissionProvider instances
// ---------------------------------------------------------------------------

export function buildSmallAfricaProviders(credentials?: ChannelCredentialsPort): TransmissionProvider[] {
  return [
    buildSmallAfricaProvider(ghGraConfig, credentials),
    buildSmallAfricaProvider(rwRraConfig, credentials),
    buildSmallAfricaProvider(tzTraConfig, credentials),
    buildSmallAfricaProvider(ugUraConfig, credentials),
    buildSmallAfricaProvider(zmZraConfig, credentials),
    buildSmallAfricaProvider(zwZimraConfig, credentials),
    buildSmallAfricaProvider(ciDgiConfig, credentials),
    buildSmallAfricaProvider(bjDgiConfig, credentials),
  ];
}

// Export a static list for registry use (no credentials needed at the stub layer)
export const SMALL_AFRICA_PROVIDERS = buildSmallAfricaProviders();
