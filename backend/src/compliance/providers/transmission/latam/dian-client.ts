/**
 * DIAN (Dirección de Impuestos y Aduanas Nacionales) e-invoice client — Colombia.
 *
 * DIAN uses a pre-validation model ("validación previa"):
 *   1. Auth: POST /oauth/token (client_credentials) → access_token
 *   2. Submit: POST /einvoicing/send — multipart with UBL 2.1 XML → trackId + CUFE
 *   3. Poll:   GET  /einvoicing/status/{trackId} → estado (ACEPTADO / RECHAZADO / EN_PROCESO)
 *
 * Docs: https://www.dian.gov.co/impuestos/factura-electronica/
 * OpenAPI: https://desarrolladores.dian.gov.co/api-referencia
 *
 * Base URLs (DIAN API Gateway):
 *   Test:  https://vpfe-hab.dian.gov.co   (Habilitación)
 *   Prod:  https://vpfe.dian.gov.co        (Producción)
 *
 * Credentials required:
 *   - Software-ID (ID de software autorizado) from DIAN portal
 *   - Client-ID / Client-secret (OAuth2 from DIAN portal)
 *   - NIT (Número de Identificación Tributaria) del emisor
 *
 * Ref format: "{companyId}|{trackId}"
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface DianHttpPort {
  /** POST /oauth/token — client_credentials grant. Returns Bearer access_token. */
  getToken(baseUrl: string, clientId: string, clientSecret: string): Promise<{ access_token: string; expires_in: number }>;
  /** POST /einvoicing/send — submit UBL 2.1 XML document. */
  sendDocument(baseUrl: string, token: string, xmlBytes: Buffer, nit: string, softwareId: string): Promise<{ trackId: string; cufe?: string; estado?: string | undefined }>;
  /** GET /einvoicing/status/{trackId} — poll clearance status. */
  getStatus(baseUrl: string, token: string, trackId: string): Promise<{ estado: string; cufe?: string; errors?: string[] }>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface DianClientConfig {
  environment: 'test' | 'prod';
  nit: string;            // NIT (10 digits) del emisor — no DV suffix
  softwareId: string;     // DIAN software-ID for the invoicing application
  clientId: string;       // OAuth2 client_id
  clientSecret: string;   // OAuth2 client_secret
}

const BASE_URLS: Record<'test' | 'prod', string> = {
  test: 'https://vpfe-hab.dian.gov.co',
  prod: 'https://vpfe.dian.gov.co',
};

export class DianClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: DianHttpPort,
    private readonly config: DianClientConfig,
  ) {
    this.baseUrl = BASE_URLS[config.environment];
  }

  async authenticate(): Promise<string> {
    const resp = await this.http.getToken(this.baseUrl, this.config.clientId, this.config.clientSecret);
    return resp.access_token;
  }

  async sendDocument(token: string, xmlBytes: Buffer): Promise<{ trackId: string; cufe?: string; estado?: string }> {
    return this.http.sendDocument(this.baseUrl, token, xmlBytes, this.config.nit, this.config.softwareId);
  }

  async pollStatus(token: string, trackId: string): Promise<{ estado: string; cufe?: string; errors?: string[] }> {
    return this.http.getStatus(this.baseUrl, token, trackId);
  }

  /** Map DIAN estado strings to transmission lifecycle status. */
  static mapEstado(estado: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    const e = (estado ?? '').toUpperCase();
    if (e === 'ACEPTADO' || e === 'ACCEPTED' || e.includes('APROBADO')) return 'CLEARED';
    if (e === 'RECHAZADO' || e === 'REJECTED' || e.includes('INVALIDO')) return 'REJECTED';
    return 'PENDING';
  }
}

// ---------------------------------------------------------------------------
// TransmissionProvider
// ---------------------------------------------------------------------------

export class DianTransmissionProvider implements TransmissionProvider {
  readonly id = 'dian';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const; // DIAN clearance is asynchronous (minutes to hours)
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };

  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select', name: 'environment', label: 'DIAN environment', required: true,
        options: [
          { label: 'Habilitación (test)', value: 'test' },
          { label: 'Producción', value: 'prod' },
        ],
        default: 'test',
      },
      { type: 'text', name: 'nit', label: 'NIT del emisor (10 dígitos)', required: true, pattern: '^\\d{10}$' },
      { type: 'text', name: 'softwareId', label: 'Software-ID (DIAN)', required: true },
      { type: 'text', name: 'clientId', label: 'Client ID (OAuth2)', required: true },
      { type: 'text', name: 'clientSecret', label: 'Client secret (OAuth2)', required: true, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Inject a DianHttpPort for testing; production uses a stub that throws clearly. */
    private readonly httpPort?: DianHttpPort,
  ) {}

  private get stubHttp(): DianHttpPort {
    return {
      getToken: async () => { throw new Error('DIAN HTTP transport not implemented — inject a DianHttpPort for production (DIAN vpfe API)'); },
      sendDocument: async () => { throw new Error('DIAN HTTP transport not implemented'); },
      getStatus: async () => { throw new Error('DIAN HTTP transport not implemented'); },
    };
  }

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) {
      log.info('transmission/dian', `no resolved config for company — skipping (key ${key})`);
      return { channel: this.channel, status: 'SKIPPED', notes: ['dian: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const nit = config.nit as string;
    const softwareId = config.softwareId as string;
    const clientId = config.clientId as string;
    const clientSecret = config.clientSecret as string;
    const environment = ((config.environment as string) ?? 'test').toLowerCase() as 'test' | 'prod';

    if (!nit || !softwareId || !clientId || !clientSecret) {
      return { channel: this.channel, status: 'SKIPPED', notes: ['dian: incomplete config (nit, softwareId, clientId, clientSecret required)'] };
    }

    // DIAN requires EN16931 UBL 2.1 document
    const ublArtifact = artifacts.find((a) => a.syntax === 'EN16931_UBL');
    if (!ublArtifact) {
      return { channel: this.channel, status: 'SKIPPED', notes: ['dian: no EN16931_UBL artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: this.channel, status: 'SKIPPED', notes: ['dian: no supplierCompanyId in context'] };
    }

    try {
      const http = this.httpPort ?? this.stubHttp;
      const client = new DianClient(http, { environment, nit, softwareId, clientId, clientSecret });

      const xmlBytes = typeof ublArtifact.bytes === 'string'
        ? Buffer.from(ublArtifact.bytes, 'utf-8')
        : ublArtifact.bytes instanceof Buffer
          ? ublArtifact.bytes
          : Buffer.from(ublArtifact.bytes);

      log.info('transmission/dian', `authenticating (nit: ${nit}, key ${key})`);
      const token = await client.authenticate();

      log.info('transmission/dian', `submitting UBL document (key ${key})`);
      const result = await client.sendDocument(token, xmlBytes);

      const ref = `${companyId}|${result.trackId}`;
      log.info('transmission/dian', `submitted → trackId ${result.trackId}${result.cufe ? `, cufe: ${result.cufe}` : ''} (key ${key})`);

      const notes: string[] = [`trackId: ${result.trackId}`];
      if (result.cufe) notes.push(`cufe: ${result.cufe}`);
      const authorityIds = result.cufe ? [{ scheme: 'CUFE', value: result.cufe }] : undefined;

      // DIAN may return immediate acceptance
      if (result.estado && DianClient.mapEstado(result.estado) === 'CLEARED') {
        return { channel: this.channel, status: 'CLEARED', ref, notes, authorityIds };
      }

      return { channel: this.channel, status: 'PENDING', ref, notes, authorityIds };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/dian', `transmit failed: ${msg} (key ${key})`);
      return { channel: this.channel, status: 'REJECTED', notes: [`dian: transmit error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: this.channel, status: 'PENDING', ref, notes: ['dian: invalid ref format'] };
    }
    const [companyId, trackId] = parts;

    if (!this.credentials) {
      return { channel: this.channel, status: 'PENDING', ref, notes: ['dian: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'dian');
      if (!resolved || !resolved.isActive) {
        return { channel: this.channel, status: 'PENDING', ref, notes: ['dian: credentials no longer active'] };
      }

      const { config } = resolved;
      const nit = config.nit as string;
      const softwareId = config.softwareId as string;
      const clientId = config.clientId as string;
      const clientSecret = config.clientSecret as string;
      const environment = ((config.environment as string) ?? 'test').toLowerCase() as 'test' | 'prod';

      const http = this.httpPort ?? this.stubHttp;
      const client = new DianClient(http, { environment, nit, softwareId, clientId, clientSecret });

      log.info('transmission/dian', `polling status for trackId ${trackId}`);
      const token = await client.authenticate();
      const statusResp = await client.pollStatus(token, trackId);

      const lifecycle = DianClient.mapEstado(statusResp.estado);
      const notes: string[] = [`estado: ${statusResp.estado}`, `trackId: ${trackId}`];
      if (statusResp.cufe) notes.push(`cufe: ${statusResp.cufe}`);
      if (statusResp.errors?.length) notes.push(...statusResp.errors.map((e) => `error: ${e}`));

      const authorityIds = statusResp.cufe ? [{ scheme: 'CUFE', value: statusResp.cufe }] : undefined;

      return { channel: this.channel, status: lifecycle, ref, notes, authorityIds };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/dian', `poll failed: ${msg}`);
      return { channel: this.channel, status: 'PENDING', ref, notes: [`dian: poll error: ${msg}`] };
    }
  }
}
