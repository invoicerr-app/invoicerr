/**
 * Brazil SEFAZ NF-e transmission provider — scaffold, live-deferred.
 * Ref format: "{companyId}|{nRec}" (lote receipt number for polling).
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { SefazClient, SefazHttpPort } from './sefaz-client';

export class SefazTransmissionProvider implements TransmissionProvider {
  readonly id = 'sefaz';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'SEFAZ environment', required: true,
        options: [{ label: 'Homologação (test)', value: 'hom' }, { label: 'Produção', value: 'prod' }],
        default: 'hom' },
      { type: 'text', name: 'cnpj', label: 'CNPJ (digits only, 14 chars)',
        placeholder: '12345678000190', required: true, minLength: 14, maxLength: 14 },
      { type: 'text', name: 'certBase64', label: 'ICP-Brasil certificate PKCS#12 (base64)',
        required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password',
        required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: SefazHttpPort,
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
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sefaz: no resolved config'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'hom').toLowerCase() as 'hom' | 'prod';
    const cnpj = config.cnpj as string;
    if (!cnpj) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sefaz: cnpj required'] };
    }

    const nfeArtifact = artifacts.find((a) => a.syntax === 'NFE');
    if (!nfeArtifact) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sefaz: no NFE artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['sefaz: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStubHttpPort();

    try {
      const client = new SefazClient(http, {
        environment: env,
        cnpj,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined,
      });

      const nfeBytes = Buffer.isBuffer(nfeArtifact.bytes)
        ? nfeArtifact.bytes
        : Buffer.from(nfeArtifact.bytes);

      log.info('transmission/sefaz', `submitting NF-e lote (CNPJ ${cnpj}, key ${key})`);
      const loteResp = await client.submitLote(nfeBytes);

      if (loteResp.cStat >= 400) {
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED',
          notes: [`sefaz: lote rejected (${loteResp.cStat}): ${loteResp.xMotivo}`] };
      }

      const ref = `${companyId}|${loteResp.nRec}`;
      log.info('transmission/sefaz', `lote submitted → nRec ${loteResp.nRec} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref,
        notes: [`nRec: ${loteResp.nRec}`, `cStat: ${loteResp.cStat} ${loteResp.xMotivo}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sefaz', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`sefaz: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sefaz: invalid ref'] };
    }
    const [companyId, nRec] = parts;

    if (!this.credentials) {
      log.todo('transmission/sefaz', `poll nRec ${nRec} — no credentials port`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sefaz: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'sefaz');
      if (!resolved?.isActive) {
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['sefaz: credentials no longer active'] };
      }

      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'hom').toLowerCase() as 'hom' | 'prod';
      const cnpj = config.cnpj as string;

      const http = this.httpPort ?? buildStubHttpPort();
      const client = new SefazClient(http, { environment: env, cnpj,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined });

      const resp = await client.pollLote(nRec);
      const category = SefazClient.mapCStat(resp.cStat);

      if (category === 'AUTHORIZED') {
        const prot = resp.protNFe?.nProt;
        return { channel: 'GOV_PORTAL_API', status: 'CLEARED', ref,
          authorityIds: prot ? [{ scheme: 'PROTOCOLO', value: prot }] : [],
          notes: [`cStat: ${resp.cStat} ${resp.xMotivo}`] };
      }
      if (category === 'REJECTED') {
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED', ref,
          notes: [`sefaz: ${resp.cStat} ${resp.xMotivo}`] };
      }
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref,
        notes: [`cStat: ${resp.cStat} ${resp.xMotivo}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sefaz', `poll failed: ${msg}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`sefaz: poll error: ${msg}`] };
    }
  }
}

function buildStubHttpPort(): SefazHttpPort {
  return {
    autorizarLote: async () => { throw new Error('SefazHttpPort not implemented — ICP-Brasil cert + live CNPJ required'); },
    retornoLote: async () => { throw new Error('SefazHttpPort not implemented'); },
    consultaSituacao: async () => { throw new Error('SefazHttpPort not implemented'); },
  };
}
