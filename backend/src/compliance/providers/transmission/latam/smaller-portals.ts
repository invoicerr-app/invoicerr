/**
 * Smaller LATAM portal clients — scaffold, live-deferred.
 *
 * Countries: CR (Costa Rica), DO (Dominican Republic), GT (Guatemala),
 *            PA (Panama), PY (Paraguay), SV (El Salvador), VE (Venezuela), BO (Bolivia).
 *
 * Each defines:
 *  - Typed base URLs (test + prod where documented).
 *  - A minimal HTTP port interface (injectable for testing).
 *  - A client class with submit() and pollStatus() methods.
 *  - A TransmissionProvider implementation for national-portals.
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
// Shared helper
// ---------------------------------------------------------------------------

const GP: ChannelType = 'GOV_PORTAL_API';

interface SmallPortalConfig {
  id: string;
  label: string;
  artifact: string; // DocumentSyntax required
  baseUrls: { test: string; prod: string };
  authHint: string;
  submitEndpoint: string;
  pollEndpoint: string;
  configFields: ChannelConfigSchema['fields'];
  /** When true this portal is async poll; when false (real-time) returns SENT. */
  isAsync?: boolean;
}

type SimpleHttpPort = {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
};

class SmallPortalClient {
  constructor(
    private readonly http: SimpleHttpPort,
    private readonly baseUrl: string,
    private readonly label: string,
  ) {}

  async submit(endpoint: string, body: unknown, token: string): Promise<{ id: string; raw: unknown }> {
    const resp = await this.http.post(`${this.baseUrl}${endpoint}`, body, { Authorization: `Bearer ${token}` });
    if (resp.status >= 400) throw new Error(`${this.label}: submission failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    // Try to extract an ID from common field names
    const id = (data['id'] ?? data['trackId'] ?? data['idEnvio'] ?? data['numEnvio'] ??
                 data['uuid'] ?? data['nRec'] ?? `tx-${Date.now()}`) as string;
    return { id: String(id), raw: data };
  }

  async pollStatus(endpoint: string, id: string, token: string): Promise<{ status: string; raw: unknown }> {
    const resp = await this.http.get(`${this.baseUrl}${endpoint}/${encodeURIComponent(id)}`,
      { Authorization: `Bearer ${token}` });
    if (resp.status >= 400) throw new Error(`${this.label}: poll failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const status = (data['estado'] ?? data['status'] ?? data['estado_doc'] ?? 'EN_PROCESO') as string;
    return { status: String(status), raw: data };
  }
}

type SomeStatus = 'CLEARED' | 'REJECTED' | 'PENDING';

function buildSmallPortalProvider(spec: SmallPortalConfig, credentials?: ChannelCredentialsPort): TransmissionProvider {
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
        const client = new SmallPortalClient(http, baseUrl, spec.label);
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
      ? async function(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
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
            const client = new SmallPortalClient(http, baseUrl, spec.label);
            const resp = await client.pollStatus(spec.pollEndpoint, id, token);
            const status = mapGenericStatus(resp.status);
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

/** Heuristic mapping of free-text portal states to TransmissionStatus. */
function mapGenericStatus(s: string): SomeStatus {
  const u = s.toUpperCase();
  const clearTokens = ['AUTORI', 'CLEARED', 'ACCEPTED', 'ACEPTAD', 'APPROVED', 'APROBAD', 'CONFIRMAD', 'DOK', 'FOK'];
  const rejectTokens = ['RECHAZ', 'REJECT', 'REFUSED', 'REFUS', 'DENIED', 'DENEGAD', 'ERREUR', 'NO AUTORI', 'INVALID'];
  if (clearTokens.some((t) => u.includes(t))) return 'CLEARED';
  if (rejectTokens.some((t) => u.includes(t))) return 'REJECTED';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Costa Rica — Ministerio de Hacienda
// ---------------------------------------------------------------------------
export const crHaciendaConfig: SmallPortalConfig = {
  id: 'cr-hacienda',
  label: 'Costa Rica Ministerio de Hacienda',
  artifact: 'CR_FE',
  baseUrls: {
    test: 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
    prod: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1',
  },
  authHint: 'OAuth2 client_credentials from Hacienda ATV portal',
  submitEndpoint: '/recepcion',
  pollEndpoint: '/comprobante',
  configFields: [
    { type: 'select', name: 'environment', label: 'Hacienda environment', required: true,
      options: [{ label: 'Sandbox (test)', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'apiToken', label: 'OAuth2 Bearer token', required: true, secret: true },
    { type: 'text', name: 'cedula', label: 'Cédula jurídica (10 digits)', required: true },
  ],
};

// ---------------------------------------------------------------------------
// Dominican Republic — DGII
// ---------------------------------------------------------------------------
export const dgiiConfig: SmallPortalConfig = {
  id: 'dgii',
  label: 'Dominican Republic DGII e-CF',
  artifact: 'DO_ECF',
  baseUrls: {
    test: 'https://ecf.dgii.gov.do/testecf/emisorreceptor',
    prod: 'https://ecf.dgii.gov.do/ecf/emisorreceptor',
  },
  authHint: 'PKCS#12 certificate from DGII-approved CA',
  submitEndpoint: '/send',
  pollEndpoint: '/status',
  configFields: [
    { type: 'select', name: 'environment', label: 'DGII environment', required: true,
      options: [{ label: 'Test (testecf)', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'rnc', label: 'RNC (9 digits)', required: true },
    { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
    { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
  ],
};

// ---------------------------------------------------------------------------
// Guatemala — SAT (via certificador)
// ---------------------------------------------------------------------------
export const gtSatConfig: SmallPortalConfig = {
  id: 'gt-sat',
  label: 'Guatemala SAT (FEL via certificador)',
  artifact: 'GT_FEL',
  baseUrls: {
    test: 'https://feltest.sat.gob.gt/dte/v1',
    prod: 'https://fel.sat.gob.gt/dte/v1',
  },
  authHint: 'API key from SAT-authorized certificador (INFILE, G4S, Megaprint)',
  submitEndpoint: '/dte',
  pollEndpoint: '/dte/status',
  configFields: [
    { type: 'select', name: 'environment', label: 'SAT environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'apiToken', label: 'Certificador API key', required: true, secret: true },
    { type: 'text', name: 'nit', label: 'NIT (digits only)', required: true },
  ],
};

// ---------------------------------------------------------------------------
// Panama — DGI (via PAC/certificador)
// ---------------------------------------------------------------------------
export const paDgiConfig: SmallPortalConfig = {
  id: 'pa-dgi',
  label: 'Panama DGI (FE via PAC)',
  artifact: 'PA_FE',
  baseUrls: {
    test: 'https://sfep-test.mef.gob.pa/api/v1',
    prod: 'https://sfep.mef.gob.pa/api/v1',
  },
  authHint: 'OAuth2 token from DGI/PAC',
  submitEndpoint: '/documentos',
  pollEndpoint: '/documentos',
  configFields: [
    { type: 'select', name: 'environment', label: 'DGI environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'apiToken', label: 'PAC/DGI Bearer token', required: true, secret: true },
    { type: 'text', name: 'ruc', label: 'RUC', required: true },
  ],
};

// ---------------------------------------------------------------------------
// Paraguay — SIFEN
// ---------------------------------------------------------------------------
export const sifenConfig: SmallPortalConfig = {
  id: 'sifen',
  label: 'Paraguay SIFEN e-Kuatia',
  artifact: 'PY_DE',
  baseUrls: {
    test: 'https://sifen.set.gov.py/de/ws/async/de/recibe',
    prod: 'https://sifen.set.gov.py/de/ws/sync/de/recibe',
  },
  authHint: 'PKCS#12 certificate from ANDE-accredited CA',
  submitEndpoint: '',
  pollEndpoint: '/consulta',
  configFields: [
    { type: 'select', name: 'environment', label: 'SIFEN environment', required: true,
      options: [{ label: 'Test (async)', value: 'test' }, { label: 'Producción (sync)', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'ruc', label: 'RUC (xxx-x format)', required: true },
    { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
    { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
  ],
};

// ---------------------------------------------------------------------------
// El Salvador — Ministerio de Hacienda DTE
// ---------------------------------------------------------------------------
export const svMhConfig: SmallPortalConfig = {
  id: 'sv-mh',
  label: 'El Salvador Ministerio de Hacienda DTE',
  artifact: 'SV_DTE',
  baseUrls: {
    test: 'https://apitest.dtes.mh.gob.sv/fesv/recepciondte',
    prod: 'https://api.dtes.mh.gob.sv/fesv/recepciondte',
  },
  authHint: 'NIT + password (FESV portal login) → Bearer token via /seguridad/auth',
  submitEndpoint: '',
  pollEndpoint: '/consultaDte',
  configFields: [
    { type: 'select', name: 'environment', label: 'MH environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'nit', label: 'NIT (xxxx-xxxxxx-xxx-x)', required: true },
    { type: 'text', name: 'apiToken', label: 'Bearer token (from FESV /seguridad/auth)', required: true, secret: true },
  ],
};

// ---------------------------------------------------------------------------
// Venezuela — SENIAT
// ---------------------------------------------------------------------------
export const seniatConfig: SmallPortalConfig = {
  id: 'seniat',
  label: 'Venezuela SENIAT factura electrónica',
  artifact: 'VE_FE',
  baseUrls: {
    // SENIAT portal endpoints are subject to change; use official SIVEF API
    test: 'https://sivef-test.seniat.gob.ve/fe/v1',
    prod: 'https://sivef.seniat.gob.ve/fe/v1',
  },
  authHint: 'RIF + clave SENIAT (SIVEF portal credentials)',
  submitEndpoint: '/emitir',
  pollEndpoint: '/consultar',
  configFields: [
    { type: 'select', name: 'environment', label: 'SENIAT environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'rif', label: 'RIF (J-xxxxxxxx-x)', required: true },
    { type: 'text', name: 'apiToken', label: 'SIVEF Bearer token', required: true, secret: true },
  ],
};

// ---------------------------------------------------------------------------
// Bolivia — SIN (Sistema Integral de Facturación)
// ---------------------------------------------------------------------------
export const boSinConfig: SmallPortalConfig = {
  id: 'bo-sin',
  label: 'Bolivia SIN facturación electrónica',
  artifact: 'BO_FE',
  baseUrls: {
    test: 'https://pilotosiatv.impuestos.gob.bo/FacturaElectronicaV3',
    prod: 'https://siatv.impuestos.gob.bo/FacturaElectronicaV3',
  },
  authHint: 'NIT + API key from SIN SIAT-V portal',
  submitEndpoint: '/registroComputarizadoCompraVenta',
  pollEndpoint: '/estadoFactura',
  configFields: [
    { type: 'select', name: 'environment', label: 'SIN environment', required: true,
      options: [{ label: 'Piloto (test)', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
    { type: 'text', name: 'nit', label: 'NIT (digits only)', required: true },
    { type: 'text', name: 'apiToken', label: 'SIN API token', required: true, secret: true },
  ],
};

// ---------------------------------------------------------------------------
// Factory: export TransmissionProvider instances
// ---------------------------------------------------------------------------

export function buildSmallLatamProviders(credentials?: ChannelCredentialsPort): TransmissionProvider[] {
  return [
    buildSmallPortalProvider(crHaciendaConfig, credentials),
    buildSmallPortalProvider(dgiiConfig, credentials),
    buildSmallPortalProvider(gtSatConfig, credentials),
    buildSmallPortalProvider(paDgiConfig, credentials),
    buildSmallPortalProvider(sifenConfig, credentials),
    buildSmallPortalProvider(svMhConfig, credentials),
    buildSmallPortalProvider(seniatConfig, credentials),
    buildSmallPortalProvider(boSinConfig, credentials),
  ];
}

// Export a static list for registry use (no credentials needed for the stub layer)
export const SMALL_LATAM_PROVIDERS = buildSmallLatamProviders();
