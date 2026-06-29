/**
 * Chile SII DTE transmission provider — scaffold, live-deferred.
 * Ref format: "{companyId}|{trackId}"
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { SiiClient, SiiHttpPort } from './sii-client';

export class SiiTransmissionProvider implements TransmissionProvider {
  readonly id = 'sii';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'SII environment', required: true,
        options: [{ label: 'Certificación (test)', value: 'cert' }, { label: 'Producción', value: 'prod' }],
        default: 'cert' },
      { type: 'text', name: 'rut', label: 'RUT (digits only, without DV)', placeholder: '76123456', required: true },
      { type: 'text', name: 'dv', label: 'DV (dígito verificador)', placeholder: '7', required: true, maxLength: 1 },
      { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: SiiHttpPort,
  ) {}

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sii: no resolved config'] };
    }
    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'cert').toLowerCase() as 'cert' | 'prod';
    const rut = config.rut as string;
    const dv = config.dv as string;
    if (!rut || !dv) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sii: rut + dv required'] };
    }

    const dteArtifact = artifacts.find((a) => a.syntax === 'CL_DTE');
    if (!dteArtifact) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sii: no CL_DTE artifact'] };
    }
    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sii: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStub();
    try {
      const client = new SiiClient(http, { environment: env, rut, dv,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });

      const dteBytes = Buffer.isBuffer(dteArtifact.bytes)
        ? dteArtifact.bytes : Buffer.from(dteArtifact.bytes);

      log.info('transmission/sii', `submitting EnvioDTE (RUT ${rut}-${dv}, key ${key})`);
      const resp = await client.submitDte(dteBytes);
      const ref = `${companyId}|${resp.trackId}`;
      log.info('transmission/sii', `submitted → trackId ${resp.trackId} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref,
        notes: [`trackId: ${resp.trackId}`, `estado: ${resp.estado}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sii', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`sii: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sii: invalid ref'] };
    }
    const [companyId, trackId] = parts;
    if (!this.credentials) {
      log.todo('transmission/sii', `poll trackId ${trackId}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sii: no credentials port'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'sii');
      if (!resolved?.isActive) {
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sii: credentials no longer active'] };
      }
      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'cert').toLowerCase() as 'cert' | 'prod';
      const http = this.httpPort ?? buildStub();
      const client = new SiiClient(http, { environment: env,
        rut: config.rut as string, dv: config.dv as string,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });
      const resp = await client.queryEstado(trackId);
      const cat = SiiClient.mapEstado(resp.estado);
      if (cat === 'CLEARED') return { channel: 'GOV_PORTAL_API', status: 'CLEARED', ref, notes: [`${resp.estado}: ${resp.glosa ?? ''}`] };
      if (cat === 'REJECTED') return { channel: 'GOV_PORTAL_API', status: 'REJECTED', ref, notes: [`sii: ${resp.estado}: ${resp.glosa ?? ''}`] };
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`${resp.estado}: ${resp.glosa ?? ''}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sii', `poll failed: ${msg}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`sii: poll error: ${msg}`] };
    }
  }
}

function buildStub(): SiiHttpPort {
  return {
    getSeed: async () => { throw new Error('SiiHttpPort not implemented — SII cert required'); },
    getToken: async () => { throw new Error('SiiHttpPort not implemented'); },
    submitEnvioDTE: async () => { throw new Error('SiiHttpPort not implemented'); },
    queryEstado: async () => { throw new Error('SiiHttpPort not implemented'); },
  };
}
