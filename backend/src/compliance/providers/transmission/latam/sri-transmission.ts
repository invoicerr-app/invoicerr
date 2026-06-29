/**
 * Ecuador SRI transmission provider — scaffold, live-deferred.
 * Ref format: "{companyId}|{claveAcceso}"
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { SriClient, SriHttpPort } from './sri-client';

export class SriTransmissionProvider implements TransmissionProvider {
  readonly id = 'sri';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'SRI environment', required: true,
        options: [{ label: 'Pruebas (test)', value: 'test' }, { label: 'Producción', value: 'prod' }],
        default: 'test' },
      { type: 'text', name: 'ruc', label: 'RUC (13 chars)', placeholder: '1792345678001', required: true },
      { type: 'text', name: 'claveAcceso', label: 'Clave de Acceso (49 chars — set by transmission)', required: false },
      { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: SriHttpPort,
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
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sri: no resolved config'] };
    }
    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'test').toLowerCase() as 'test' | 'prod';
    const ruc = config.ruc as string;
    if (!ruc) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sri: ruc required'] };

    const ecArtifact = artifacts.find((a) => a.syntax === 'EC_FE');
    if (!ecArtifact) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sri: no EC_FE artifact'] };
    const companyId = ctx.supplierCompanyId;
    if (!companyId) return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sri: no supplierCompanyId'] };

    const http = this.httpPort ?? buildStub();
    try {
      const client = new SriClient(http, { environment: env, ruc,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });

      const xmlBytes = Buffer.isBuffer(ecArtifact.bytes)
        ? ecArtifact.bytes : Buffer.from(ecArtifact.bytes);

      log.info('transmission/sri', `submitting comprobante (RUC ${ruc}, key ${key})`);
      const recepResp = await client.submitComprobante(xmlBytes);

      if (SriClient.mapEstado(recepResp.estado) === 'REJECTED') {
        const errs = recepResp.comprobantes?.[0]?.mensajes?.map((m) => m.mensaje).join('; ') ?? '';
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`sri: ${recepResp.estado} — ${errs}`] };
      }

      // Extract claveAcceso from the response or from the XML (TODO: parse from signed XML)
      const claveAcceso = recepResp.comprobantes?.[0]?.claveAcceso ?? `TODO-CLAVE-${key}`;
      const ref = `${companyId}|${claveAcceso}`;
      log.info('transmission/sri', `recibida → claveAcceso ${claveAcceso} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref,
        notes: [`claveAcceso: ${claveAcceso}`, `estado: ${recepResp.estado}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sri', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`sri: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sri: invalid ref'] };
    const [companyId, claveAcceso] = parts;
    if (!this.credentials) {
      log.todo('transmission/sri', `poll claveAcceso ${claveAcceso}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sri: no credentials port'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'sri');
      if (!resolved?.isActive) return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sri: credentials inactive'] };
      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'test').toLowerCase() as 'test' | 'prod';
      const http = this.httpPort ?? buildStub();
      const client = new SriClient(http, { environment: env, ruc: config.ruc as string,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });
      const resp = await client.pollAutorizacion(claveAcceso);
      const aut = resp.autorizaciones[0];
      if (!aut) return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sri: no autorizacion in response'] };
      if (aut.estado === 'AUTORIZADO') {
        return { channel: 'GOV_PORTAL_API', status: 'CLEARED', ref,
          authorityIds: aut.numeroAutorizacion ? [{ scheme: 'AUTORIZACION', value: aut.numeroAutorizacion }] : [],
          notes: [`autorizado: ${aut.fechaAutorizacion ?? ''}`] };
      }
      const errMsg = aut.mensajes?.map((m) => m.mensaje).join('; ') ?? '';
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', ref, notes: [`sri: NO AUTORIZADO — ${errMsg}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sri', `poll failed: ${msg}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`sri: poll error: ${msg}`] };
    }
  }
}

function buildStub(): SriHttpPort {
  return {
    recibirComprobante: async () => { throw new Error('SriHttpPort not implemented — SRI cert required'); },
    autorizarComprobante: async () => { throw new Error('SriHttpPort not implemented'); },
  };
}
