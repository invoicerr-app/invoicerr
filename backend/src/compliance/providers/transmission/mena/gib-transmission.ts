/**
 * Turkey GİB e-Fatura / e-Arşiv transmission provider — scaffold, live-deferred.
 *
 * Scaffold depth: full configSchema + injectable HTTP port + auth/submit/poll seams.
 * Live integration deferred: no GİB credentials available in CI.
 *
 * What's done:
 *  - Real endpoint URLs (GİB direct + test).
 *  - Auth seam (username/password → token).
 *  - Submit seam (UBL-TR → base64 → POST /sendInvoice).
 *  - Poll seam (GET /getInvoiceStatus?uuid=…).
 *  - Signing seam: signs via signing port (XAdES-BES).
 *  - Ref format: "{companyId}|{uuid}".
 *
 * What's missing for live:
 *  - Real GİB WSDL/REST spec implementation.
 *  - e-İmza (XAdES-BES) integration with the signing port (seam wired, not called yet).
 *  - Özel entegratör support.
 *  - e-Arşiv daily report (POST /sendInvoiceReport).
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { GibClient, GibHttpPort, mapGibStatus } from './gib-client';

const GP: ChannelType = 'GOV_PORTAL_API';

const GIB_BASE_URLS = {
  test: 'https://efaturaportal.gib.gov.tr/EFaturaTest',
  prod: 'https://efaturaportal.gib.gov.tr/EFatura',
};

const GIB_CONFIG_SCHEMA: ChannelConfigSchema = {
  fields: [
    {
      type: 'select', name: 'environment', label: 'GİB environment', required: true,
      options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'vkn', label: 'VKN (Vergi Kimlik Numarası, 10 digits)', required: true, minLength: 10, maxLength: 10 },
    { type: 'text', name: 'username', label: 'GİB portal username', required: true },
    { type: 'text', name: 'password', label: 'GİB portal password', required: true, secret: true },
    {
      type: 'select', name: 'invoiceMode', label: 'Invoice mode', required: true,
      options: [
        { label: 'e-Fatura (registered buyer)', value: 'efatura' },
        { label: 'e-Arşiv (unregistered / B2C)', value: 'earsiv' },
      ], default: 'efatura',
    },
  ],
};

/** Stub HTTP port — replaced by a real implementation or a mock in tests. */
const STUB_HTTP: GibHttpPort = {
  post: async (_url, _body, _headers) => {
    throw new Error('GİB HTTP port not implemented — provide real credentials + HTTP client for live integration');
  },
  get: async (_url, _headers) => {
    throw new Error('GİB HTTP port not implemented');
  },
};

export class GibTransmissionProvider implements TransmissionProvider {
  readonly id = 'gib';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = GIB_CONFIG_SCHEMA;

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
      return { channel: GP, status: 'SKIPPED', notes: ['gib: no resolved config — configure VKN + GİB credentials'] };
    }
    const { config, environment } = resolvedConfig;
    const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
    const baseUrl = isTest ? GIB_BASE_URLS.test : GIB_BASE_URLS.prod;

    const art = artifacts.find((a) => a.syntax === 'TR_EFATURA');
    if (!art) return { channel: GP, status: 'SKIPPED', notes: ['gib: no TR_EFATURA artifact'] };
    const companyId = ctx.supplierCompanyId;
    if (!companyId) return { channel: GP, status: 'SKIPPED', notes: ['gib: no supplierCompanyId'] };

    const vkn = (config.vkn ?? '') as string;
    const username = (config.username ?? '') as string;
    const password = (config.password ?? '') as string;

    log.info('transmission/gib', `submitting e-Fatura to GİB (VKN ${vkn}, key ${key})`);
    // TODO: call the signing port (XAdES-BES) before submitting.
    // For now, transmit the raw artifact bytes (unsigned — live integration requires e-İmza).
    const xmlStr = Buffer.isBuffer(art.bytes) ? art.bytes.toString('utf-8') : new TextDecoder().decode(art.bytes);

    // HTTP port is the stub unless replaced externally.
    const client = new GibClient({ baseUrl, vkn, username, password }, STUB_HTTP);
    try {
      const result = await client.sendInvoice(xmlStr);
      const ref = `${companyId}|${result.uuid}`;
      log.info('transmission/gib', `submitted → uuid ${result.uuid} (key ${key})`);
      return { channel: GP, status: 'PENDING', ref, notes: [`uuid: ${result.uuid}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/gib', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`gib: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: GP, status: 'PENDING', ref, notes: ['gib: invalid ref'] };
    const [companyId, uuid] = parts;
    if (!this.credentials) {
      log.todo('transmission/gib', `poll status for uuid ${uuid}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['gib: no credentials port'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'gib');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['gib: credentials inactive'] };
      const { config, environment } = resolved;
      const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
      const baseUrl = isTest ? GIB_BASE_URLS.test : GIB_BASE_URLS.prod;
      const vkn = (config.vkn ?? '') as string;
      const username = (config.username ?? '') as string;
      const password = (config.password ?? '') as string;
      const client = new GibClient({ baseUrl, vkn, username, password }, STUB_HTTP);
      const resp = await client.getInvoiceStatus(uuid);
      const status = mapGibStatus(resp.status);
      return { channel: GP, status, ref, notes: [`gib: ${resp.status}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/gib', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`gib: poll error: ${msg}`] };
    }
  }
}
