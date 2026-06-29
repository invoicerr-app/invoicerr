/**
 * MENA smaller portal clients — scaffold, live-deferred.
 *
 * Countries: JO (Jordan — JoFotara), TN (Tunisia — TTN El Fatoora).
 *
 * TR (Turkey GİB) and EG (Egypt ETA) have deeper dedicated clients
 * (gib-transmission.ts / eg-eta-transmission.ts) due to complexity.
 *
 * Pattern mirrors africa/smaller-portals.ts.
 * All live calls are deferred — no public sandbox credentials available.
 *
 * Ref format: "{companyId}|{submissionId}"
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';

const GP: ChannelType = 'GOV_PORTAL_API';

interface SmallMenaPortalConfig {
  id: string;
  label: string;
  artifact: string;
  baseUrls: { test: string; prod: string };
  authHint: string;
  submitEndpoint: string;
  pollEndpoint: string;
  configFields: ChannelConfigSchema['fields'];
  isAsync?: boolean;
}

type SimpleHttpPort = {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
};

class SmallMenaPortalClient {
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
      data['id'] ?? data['uuid'] ?? data['submissionId'] ?? data['invoiceId'] ??
      data['referenceNumber'] ?? data['receiptNo'] ?? `tx-${Date.now()}`
    ) as string;
    return { id: String(id), raw: data };
  }

  async pollStatus(endpoint: string, id: string, token: string): Promise<{ status: string; raw: unknown }> {
    const resp = await this.http.get(`${this.baseUrl}${endpoint}/${encodeURIComponent(id)}`,
      { Authorization: `Bearer ${token}` });
    if (resp.status >= 400) throw new Error(`${this.label}: poll failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const status = (data['status'] ?? data['invoiceStatus'] ?? data['result'] ?? 'PENDING') as string;
    return { status: String(status), raw: data };
  }
}

type SomeStatus = 'CLEARED' | 'REJECTED' | 'PENDING';

function mapMenaStatus(s: string): SomeStatus {
  const u = s.toUpperCase();
  const clearTokens = ['APPROVED', 'CLEARED', 'ACCEPTED', 'VALID', 'SUCCESS', 'CONFIRMED', 'REGISTERED'];
  const rejectTokens = ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'DENIED'];
  if (clearTokens.some((t) => u.includes(t))) return 'CLEARED';
  if (rejectTokens.some((t) => u.includes(t))) return 'REJECTED';
  return 'PENDING';
}

function buildSmallMenaProvider(spec: SmallMenaPortalConfig, credentials?: ChannelCredentialsPort): TransmissionProvider {
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

      try {
        const client = new SmallMenaPortalClient(stub, baseUrl, spec.label);
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
            const client = new SmallMenaPortalClient(stub, baseUrl, spec.label);
            const resp = await client.pollStatus(spec.pollEndpoint, id, token);
            const status = mapMenaStatus(resp.status);
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

// ---------------------------------------------------------------------------
// Jordan — JoFotara (ISTD national platform, UBL-based)
// ---------------------------------------------------------------------------
export const joJofotaraConfig: SmallMenaPortalConfig = {
  id: 'jofotara',
  label: 'Jordan JoFotara (ISTD)',
  artifact: 'JO_JOFOTARA',
  baseUrls: {
    test: 'https://jofotara-test.istd.gov.jo/api/v1',
    prod: 'https://jofotara.istd.gov.jo/api/v1',
  },
  authHint: 'ISTD JoFotara merchant credentials (TIN + API key from ISTD merchant portal)',
  submitEndpoint: '/invoices/submit',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'JoFotara environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'tin', label: 'Jordan TIN (10 digits)', required: true, minLength: 10, maxLength: 10 },
    { type: 'text', name: 'merchantId', label: 'JoFotara Merchant ID', required: true },
    { type: 'text', name: 'apiToken', label: 'JoFotara API key', required: true, secret: true },
  ],
  isAsync: true, // JoFotara uses async clearance flow
};

// ---------------------------------------------------------------------------
// Tunisia — TTN El Fatoora (TEIF via TradeNet)
// ---------------------------------------------------------------------------
export const tnTtnConfig: SmallMenaPortalConfig = {
  id: 'tn-ttn',
  label: 'Tunisia TTN El Fatoora (TEIF)',
  artifact: 'TN_TEIF',
  baseUrls: {
    test: 'https://elfattoura-test.tradenet.com.tn/api/v1',
    prod: 'https://elfattoura.tradenet.com.tn/api/v1',
  },
  authHint: 'TradeNet (TTN) subscriber credentials — MF (matricule fiscal) + API key from TTN subscription',
  submitEndpoint: '/factures/soumettre',
  pollEndpoint: '/factures/statut',
  configFields: [
    {
      type: 'select', name: 'environment', label: 'TTN environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'matriculeFiscal', label: 'Matricule Fiscal (MF)', required: true },
    { type: 'text', name: 'ttnSubscriberId', label: 'TTN Subscriber ID', required: true },
    { type: 'text', name: 'apiToken', label: 'TTN El Fatoora API key', required: true, secret: true },
  ],
  isAsync: true, // El Fatoora has async clearance flow
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function buildSmallMenaProviders(credentials?: ChannelCredentialsPort): TransmissionProvider[] {
  return [
    buildSmallMenaProvider(joJofotaraConfig, credentials),
    buildSmallMenaProvider(tnTtnConfig, credentials),
  ];
}

export const SMALL_MENA_PROVIDERS = buildSmallMenaProviders();
