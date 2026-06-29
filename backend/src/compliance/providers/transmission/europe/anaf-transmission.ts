/**
 * Romania ANAF SPV / e-Factura transmission provider — scaffold, live-deferred.
 *
 * Depth: deeper than the generic smaller-portals pattern — real ANAF API endpoints,
 * OAuth2 client_credentials flow, upload + poll stare, typed response parsing.
 *
 * What's done:
 *  - Real ANAF test + prod endpoint URLs.
 *  - configSchema with CIF, OAuth2 client_id/secret.
 *  - upload via PUT /upload?standard=UBL&cif={cif}.
 *  - Poll via GET /stareMesaj?id_incarcare={id}.
 *  - mapAnafStatus: ok→CLEARED, nok→REJECTED, else PENDING.
 *  - Ref format: "{companyId}|{idIncarcare}".
 *
 * Missing for live:
 *  - Real ANAF OAuth2 Authorization Code flow with qualified certificate.
 *  - Download signed document (GET /descarcare?id={id}).
 *  - RO_CIUS extension fields in the UBL document.
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { AnafClient, AnafHttpPort, mapAnafStatus } from './anaf-client';

const GP: ChannelType = 'GOV_PORTAL_API';

const ANAF_URLS = {
  test: {
    baseUrl: 'https://api.anaf.ro/test/FCTEL/rest',
    tokenUrl: 'https://logincert.anaf.ro/anaf-oauth2/v1',
  },
  prod: {
    baseUrl: 'https://api.anaf.ro/prod/FCTEL/rest',
    tokenUrl: 'https://logincert.anaf.ro/anaf-oauth2/v1',
  },
};

const ANAF_CONFIG_SCHEMA: ChannelConfigSchema = {
  fields: [
    {
      type: 'select', name: 'environment', label: 'ANAF environment', required: true,
      options: [{ label: 'Test (SPV sandbox)', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'cif', label: 'CUI/CIF (Romanian tax ID, digits only — no "RO" prefix)', required: true },
    { type: 'text', name: 'clientId', label: 'OAuth2 Client ID (from ANAF SPV portal registration)', required: true },
    { type: 'text', name: 'clientSecret', label: 'OAuth2 Client Secret (ANAF SPV)', required: true, secret: true },
  ],
};

/** Stub HTTP port — replace with real httpclient or mock in tests. */
const STUB_HTTP: AnafHttpPort = {
  post: async () => { throw new Error('ANAF HTTP port not implemented — provide real credentials + HTTP client'); },
  get: async () => { throw new Error('ANAF HTTP port not implemented'); },
  put: async () => { throw new Error('ANAF HTTP port not implemented'); },
};

export class AnafTransmissionProvider implements TransmissionProvider {
  readonly id = 'anaf';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 72, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = ANAF_CONFIG_SCHEMA;

  constructor(private readonly credentials?: ChannelCredentialsPort) {}

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) {
      return { channel: GP, status: 'SKIPPED', notes: ['anaf: no resolved config — configure CIF + OAuth2 credentials'] };
    }
    const { config, environment } = resolvedConfig;
    const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
    const urls = isTest ? ANAF_URLS.test : ANAF_URLS.prod;
    const cif = (config.cif ?? '') as string;
    const clientId = (config.clientId ?? '') as string;
    const clientSecret = (config.clientSecret ?? '') as string;

    // ANAF requires EN16931_UBL (UBL 2.1 + RO_CIUS extension)
    const art = artifacts.find((a) => a.syntax === 'EN16931_UBL');
    if (!art) return { channel: GP, status: 'SKIPPED', notes: ['anaf: no EN16931_UBL artifact'] };
    const companyId = ctx.supplierCompanyId;
    if (!companyId) return { channel: GP, status: 'SKIPPED', notes: ['anaf: no supplierCompanyId'] };

    log.info('transmission/anaf', `uploading e-Factura to ANAF SPV (CIF ${cif}, key ${key})`);
    const xmlStr = Buffer.isBuffer(art.bytes) ? art.bytes.toString('utf-8') : new TextDecoder().decode(art.bytes);

    const client = new AnafClient(
      { baseUrl: urls.baseUrl, tokenUrl: urls.tokenUrl, clientId, clientSecret, cif },
      STUB_HTTP,
    );
    try {
      const result = await client.uploadInvoice(xmlStr);
      const ref = `${companyId}|${result.idIncarcare}`;
      log.info('transmission/anaf', `uploaded → id_incarcare ${result.idIncarcare} (key ${key})`);
      return { channel: GP, status: 'PENDING', ref, notes: [`id_incarcare: ${result.idIncarcare}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/anaf', `upload failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`anaf: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: GP, status: 'PENDING', ref, notes: ['anaf: invalid ref'] };
    const [companyId, idIncarcare] = parts;
    if (!this.credentials) {
      log.todo('transmission/anaf', `poll stareMesaj for id_incarcare ${idIncarcare}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['anaf: no credentials port'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'anaf');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['anaf: credentials inactive'] };
      const { config, environment } = resolved;
      const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
      const urls = isTest ? ANAF_URLS.test : ANAF_URLS.prod;
      const cif = (config.cif ?? '') as string;
      const clientId = (config.clientId ?? '') as string;
      const clientSecret = (config.clientSecret ?? '') as string;
      const client = new AnafClient(
        { baseUrl: urls.baseUrl, tokenUrl: urls.tokenUrl, clientId, clientSecret, cif },
        STUB_HTTP,
      );
      const resp = await client.getStatus(idIncarcare);
      const status = mapAnafStatus(resp.stare);
      return { channel: GP, status, ref, notes: [`anaf: stare=${resp.stare}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/anaf', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`anaf: poll error: ${msg}`] };
    }
  }
}
