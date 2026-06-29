/**
 * Uruguay DGI CFE transmission provider — scaffold, live-deferred.
 * Ref format: "{companyId}|{idEnvio}"
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { UyDgiClient, UyDgiHttpPort } from './uy-dgi-client';

export class UyDgiTransmissionProvider implements TransmissionProvider {
  readonly id = 'uy-dgi';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'DGI environment', required: true,
        options: [{ label: 'Test (port 6443)', value: 'test' }, { label: 'Producción', value: 'prod' }],
        default: 'test' },
      { type: 'text', name: 'rut', label: 'RUT (digits only)', placeholder: '214002340010', required: true },
      { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: UyDgiHttpPort,
  ) {}

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['uy-dgi: no resolved config'] };
    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'test').toLowerCase() as 'test' | 'prod';
    const rut = config.rut as string;
    if (!rut) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['uy-dgi: rut required'] };

    const uyArtifact = artifacts.find((a) => a.syntax === 'UY_CFE');
    if (!uyArtifact) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['uy-dgi: no UY_CFE artifact'] };
    const companyId = ctx.supplierCompanyId;
    if (!companyId) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['uy-dgi: no supplierCompanyId'] };

    const http = this.httpPort ?? buildStub();
    try {
      const client = new UyDgiClient(http, { environment: env, rut,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });

      const cfeBytes = Buffer.isBuffer(uyArtifact.bytes)
        ? uyArtifact.bytes : Buffer.from(uyArtifact.bytes);

      log.info('transmission/uy-dgi', `submitting CFE (RUT ${rut}, key ${key})`);
      const resp = await client.enviarCfe(cfeBytes);

      if (UyDgiClient.mapEstado(resp.estado) === 'REJECTED') {
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`uy-dgi: ${resp.estado} — ${resp.errorMsg ?? ''}`] };
      }

      const ref = `${companyId}|${resp.idEnvio}`;
      log.info('transmission/uy-dgi', `CFE recibida → idEnvio ${resp.idEnvio} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`idEnvio: ${resp.idEnvio}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/uy-dgi', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`uy-dgi: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['uy-dgi: invalid ref'] };
    const [companyId, idEnvio] = parts;
    if (!this.credentials) {
      log.todo('transmission/uy-dgi', `poll idEnvio ${idEnvio}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['uy-dgi: no credentials port'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'uy-dgi');
      if (!resolved?.isActive) return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['uy-dgi: credentials inactive'] };
      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'test').toLowerCase() as 'test' | 'prod';
      const http = this.httpPort ?? buildStub();
      const client = new UyDgiClient(http, { environment: env, rut: config.rut as string,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });
      const resp = await client.obtenerRespuesta(idEnvio);
      const cat = UyDgiClient.mapEstado(resp.estado);
      if (cat === 'CLEARED') {
        return { channel: 'GOV_PORTAL_API', status: 'CLEARED', ref,
          authorityIds: resp.cae ? [{ scheme: 'CAE', value: resp.cae }] : [],
          notes: resp.cae ? [`CAE: ${resp.cae}`, `vto: ${resp.caeFechaVto ?? ''}`] : [] };
      }
      if (cat === 'REJECTED') {
        const errs = resp.rechazos?.map((r) => `${r.codigo}: ${r.descripcion}`).join('; ') ?? '';
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED', ref, notes: [`uy-dgi: rechazado — ${errs}`] };
      }
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`uy-dgi: ${resp.estado}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/uy-dgi', `poll failed: ${msg}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`uy-dgi: poll error: ${msg}`] };
    }
  }
}

function buildStub(): UyDgiHttpPort {
  return {
    enviarCfe: async () => { throw new Error('UyDgiHttpPort not implemented — DGI cert required'); },
    obtenerRespuesta: async () => { throw new Error('UyDgiHttpPort not implemented'); },
  };
}
