import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';
import type { PacHttpPort } from './latam/pac-client';

/**
 * Mexico — Proveedor Autorizado de Certificación (timbrado → UUID/TimbreFiscalDigital).
 *
 * LIVE PROOF: DEFERRED — requires SAT CSD certificate + a PAC contract.
 * All unit tests use a mocked PacHttpPort.
 *
 * Transmission flow:
 *   1. transmit(): find CFDI artifact → timbrar() → UUID returned synchronously by the PAC.
 *   2. poll(): re-check SAT registration status via consultaEstado() (for async PAC environments).
 *   3. unconfigured (no baseUrl/apiKey/rfc) → SKIPPED.
 *
 * Ref format: "{companyId}|{uuid}"
 */
export class PacTransmissionProvider implements TransmissionProvider {
  readonly id = 'pac';
  readonly channel: ChannelType = 'PAC';
  /** STUB — "PAC" is a market of interchangeable vendors (SW Sapien, Finkok, Facturapi, …),
   * each with a different real API; this client models only the common denominator, so
   * there is no single real transport to target/prove. */
  readonly maturity: ProviderMaturity = 'STUB';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select',
        name: 'environment',
        label: 'PAC environment',
        required: true,
        options: [
          { label: 'Test (sandbox)', value: 'test' },
          { label: 'Producción', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'baseUrl',
        label: 'PAC API base URL',
        placeholder: 'https://services.test.sw.com.mx',
        required: true,
      },
      { type: 'text', name: 'apiKey', label: 'PAC API key', required: true, secret: true },
      {
        type: 'text',
        name: 'rfc',
        label: 'Emisor RFC',
        placeholder: 'AAA010101AAA',
        required: true,
        minLength: 12,
        maxLength: 13,
      },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: PacHttpPort,
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
      log.info('transmission/pac', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'PAC', status: 'SKIPPED', notes: ['pac: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const baseUrl = config.baseUrl as string;
    const apiKey = config.apiKey as string;
    const rfc = config.rfc as string;
    const environment = ((config.environment as string) ?? 'test').toLowerCase() as 'test' | 'prod';

    if (!baseUrl || !apiKey || !rfc) {
      return {
        channel: 'PAC',
        status: 'SKIPPED',
        notes: ['pac: incomplete config (baseUrl, apiKey, rfc required)'],
      };
    }

    // Find CFDI artifact
    const cfdiArtifact = artifacts.find((a) => a.syntax === 'CFDI');
    if (!cfdiArtifact) {
      return { channel: 'PAC', status: 'SKIPPED', notes: ['pac: no CFDI artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'PAC', status: 'SKIPPED', notes: ['pac: no supplierCompanyId'] };
    }

    try {
      const { PacClient } = await import('./latam/pac-client.js');

      // Inject test HTTP port or use a stub that throws clearly for missing live credentials.
      const http: PacHttpPort = this.httpPort ?? {
        timbrar: async () => {
          throw new Error(
            'PAC transport not implemented — provide a PacHttpPort for your PAC (e.g. SW Sapien, Finkok, Facturapi)',
          );
        },
        consultaEstado: async () => {
          throw new Error('PAC transport not implemented — provide a PacHttpPort');
        },
      };

      const client = new PacClient(http, { environment, baseUrl, apiKey, rfc });

      const cfdiBytes =
        typeof cfdiArtifact.bytes === 'string'
          ? Buffer.from(cfdiArtifact.bytes, 'utf-8')
          : cfdiArtifact.bytes instanceof Buffer
            ? cfdiArtifact.bytes
            : Buffer.from(cfdiArtifact.bytes);

      log.info('transmission/pac', `timbrado via PAC (rfc ${rfc}, key ${key})`);
      const timbre = await client.timbrar(cfdiBytes);

      const ref = `${companyId}|${timbre.uuid}`;
      log.info('transmission/pac', `timbrado → uuid ${timbre.uuid} (key ${key})`);
      return {
        channel: 'PAC',
        status: 'CLEARED',
        ref,
        authorityIds: [{ scheme: 'UUID', value: timbre.uuid }],
        notes: [`uuid: ${timbre.uuid}`, `noCertificadoSat: ${timbre.noCertificadoSat}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/pac', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'PAC', status: 'REJECTED', notes: [`pac: transmit error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'PAC', status: 'PENDING', ref, notes: ['pac: invalid ref format'] };
    }
    const [companyId, uuid] = parts;

    if (!this.credentials) {
      return { channel: 'PAC', status: 'PENDING', ref, notes: ['pac: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'pac');
      if (!resolved || !resolved.isActive) {
        return { channel: 'PAC', status: 'PENDING', ref, notes: ['pac: credentials no longer active'] };
      }

      const { config } = resolved;
      const baseUrl = config.baseUrl as string;
      const apiKey = config.apiKey as string;
      const rfc = config.rfc as string;
      const environment = ((config.environment as string) ?? 'test').toLowerCase() as 'test' | 'prod';
      const rfcReceptor = (config.rfcReceptor as string) ?? 'XAXX010101000';
      const total = (config.total as string) ?? '0.00';

      const { PacClient } = await import('./latam/pac-client.js');
      const http: PacHttpPort = this.httpPort ?? {
        timbrar: async () => {
          throw new Error('PAC transport not implemented');
        },
        consultaEstado: async () => {
          throw new Error('PAC transport not implemented');
        },
      };
      const client = new PacClient(http, { environment, baseUrl, apiKey, rfc });

      log.info('transmission/pac', `polling SAT status for uuid ${uuid}`);
      const estado = await client.consultaEstado(uuid, rfcReceptor, total);

      const mapped = PacClient.mapEstado(estado.status);
      const notes: string[] = [`uuid: ${uuid}`, `estado: ${estado.status}`];
      if (estado.acuse) notes.push(`acuse: ${estado.acuse}`);
      return {
        channel: 'PAC',
        status: mapped === 'CLEARED' ? 'CLEARED' : mapped === 'REJECTED' ? 'REJECTED' : 'PENDING',
        ref,
        notes,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/pac', `poll failed: ${msg}`);
      return { channel: 'PAC', status: 'PENDING', ref, notes: [`pac: poll error: ${msg}`] };
    }
  }
}
