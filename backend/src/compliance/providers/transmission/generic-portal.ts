/**
 * Generic national-portal scaffold — shared factory for the "smaller portals".
 *
 * One TransmissionProvider shape covers every scaffolded GOV_PORTAL_API portal
 * (LATAM / MENA / Africa / Asia / Europe-national). Per-portal facts live in a
 * `GenericPortalSpec` (pure data: endpoints, config form, async-ness) and the
 * per-region response conventions live in `PortalResponseHeuristics` (which
 * response fields carry the submission id / status, and which status strings
 * mean CLEARED vs REJECTED).
 *
 * All live calls are deferred — the default HTTP port throws until a real
 * integration lands (no public sandbox credentials available). An HTTP port
 * can be injected for tests.
 *
 * Ref format (all portals): "{companyId}|{submissionId}"
 */

import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from './transmission-provider';

const GP: ChannelType = 'GOV_PORTAL_API';

// ---------------------------------------------------------------------------
// Spec + heuristics (pure data, provided by the regional modules)
// ---------------------------------------------------------------------------

export interface GenericPortalSpec {
  id: string;
  label: string;
  /** DocumentSyntax required by this portal. */
  artifact: string;
  baseUrls: { test: string; prod: string };
  /** What credentials the real integration needs (surfaced in stub errors). */
  authHint: string;
  submitEndpoint: string;
  pollEndpoint: string;
  configFields: ChannelConfigSchema['fields'];
  /**
   * When true (default): clearance-style — async, poll for authorization (ASYNC_POLL).
   * When false: real-time/reporting — fire-and-forget, returns SENT (NONE).
   */
  isAsync?: boolean;
}

/** Per-region response conventions — how portals of that region name ids/statuses. */
export interface PortalResponseHeuristics {
  /** Response fields probed (in order) for the submission id. */
  idFields: string[];
  /** Response fields probed (in order) for the poll status string. */
  statusFields: string[];
  /** Raw status assumed when none of the statusFields is present. */
  statusFallback: string;
  /** Uppercase substrings mapping a raw status to CLEARED. Checked before rejectTokens. */
  clearTokens: string[];
  /** Uppercase substrings mapping a raw status to REJECTED. */
  rejectTokens: string[];
}

// ---------------------------------------------------------------------------
// HTTP port + client
// ---------------------------------------------------------------------------

export type SimpleHttpPort = {
  post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
};

function pickField(data: Record<string, unknown>, fields: string[]): unknown {
  for (const f of fields) {
    const v = data[f];
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}

export class GenericPortalClient {
  constructor(
    private readonly http: SimpleHttpPort,
    private readonly baseUrl: string,
    private readonly label: string,
    private readonly heuristics: PortalResponseHeuristics,
  ) {}

  async submit(endpoint: string, body: unknown, token: string): Promise<{ id: string; raw: unknown }> {
    const resp = await this.http.post(`${this.baseUrl}${endpoint}`, body, {
      Authorization: `Bearer ${token}`,
    });
    if (resp.status >= 400) throw new Error(`${this.label}: submission failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const id = pickField(data, this.heuristics.idFields) ?? `tx-${Date.now()}`;
    return { id: String(id), raw: data };
  }

  async pollStatus(endpoint: string, id: string, token: string): Promise<{ status: string; raw: unknown }> {
    const resp = await this.http.get(`${this.baseUrl}${endpoint}/${encodeURIComponent(id)}`, {
      Authorization: `Bearer ${token}`,
    });
    if (resp.status >= 400) throw new Error(`${this.label}: poll failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const status = pickField(data, this.heuristics.statusFields) ?? this.heuristics.statusFallback;
    return { status: String(status), raw: data };
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export type PortalStatus = 'CLEARED' | 'REJECTED' | 'PENDING';

/** Heuristic mapping of free-text portal states to TransmissionStatus. */
export function mapPortalStatus(s: string, heuristics: PortalResponseHeuristics): PortalStatus {
  const u = s.toUpperCase();
  if (heuristics.clearTokens.some((t) => u.includes(t))) return 'CLEARED';
  if (heuristics.rejectTokens.some((t) => u.includes(t))) return 'REJECTED';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function buildGenericPortalProvider(
  spec: GenericPortalSpec,
  heuristics: PortalResponseHeuristics,
  credentials?: ChannelCredentialsPort,
  httpPort?: SimpleHttpPort,
): TransmissionProvider {
  const stub: SimpleHttpPort = {
    post: async () => {
      throw new Error(`${spec.label} HTTP port not implemented — ${spec.authHint}`);
    },
    get: async () => {
      throw new Error(`${spec.label} HTTP port not implemented`);
    },
  };
  const http = httpPort ?? stub;

  return {
    id: spec.id,
    channel: GP,
    feedback: spec.isAsync !== false ? 'ASYNC_POLL' : 'NONE',
    pollPolicy:
      spec.isAsync !== false ? { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' } : undefined,
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
      if (!art)
        return { channel: GP, status: 'SKIPPED', notes: [`${spec.id}: no ${spec.artifact} artifact`] };
      const companyId = ctx.supplierCompanyId;
      if (!companyId) return { channel: GP, status: 'SKIPPED', notes: [`${spec.id}: no supplierCompanyId`] };

      try {
        const client = new GenericPortalClient(http, baseUrl, spec.label, heuristics);
        const xmlStr = Buffer.isBuffer(art.bytes)
          ? art.bytes.toString('utf-8')
          : new TextDecoder().decode(art.bytes);
        log.info(`transmission/${spec.id}`, `submitting to ${spec.label} (key ${key})`);
        const result = await client.submit(
          spec.submitEndpoint,
          { document: xmlStr, idempotencyKey: key },
          token,
        );
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

    poll:
      spec.isAsync !== false
        ? async (ref: string, log: ComplianceLogger): Promise<TransmissionResult> => {
            const parts = ref.split('|');
            if (parts.length !== 2)
              return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: invalid ref`] };
            const [companyId, id] = parts;
            if (!credentials) {
              log.todo(`transmission/${spec.id}`, `poll ${id}`);
              return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: no credentials port`] };
            }
            try {
              const resolved = await credentials.resolveActive(companyId, spec.id);
              if (!resolved?.isActive)
                return { channel: GP, status: 'PENDING', ref, notes: [`${spec.id}: credentials inactive`] };
              const { config, environment } = resolved;
              const isTest =
                ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
              const baseUrl = isTest ? spec.baseUrls.test : spec.baseUrls.prod;
              const token = (config.apiToken ?? config.token ?? config.accessToken ?? '') as string;
              const client = new GenericPortalClient(http, baseUrl, spec.label, heuristics);
              const resp = await client.pollStatus(spec.pollEndpoint, id, token);
              const status = mapPortalStatus(resp.status, heuristics);
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

export function buildGenericPortalProviders(
  specs: GenericPortalSpec[],
  heuristics: PortalResponseHeuristics,
  credentials?: ChannelCredentialsPort,
  httpPort?: SimpleHttpPort,
): TransmissionProvider[] {
  return specs.map((spec) => buildGenericPortalProvider(spec, heuristics, credentials, httpPort));
}
