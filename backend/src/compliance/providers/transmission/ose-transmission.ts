import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';
import type { OseHttpPort, OseTipoDoc } from './latam/ose-client';

/**
 * Peru — Operador de Servicios Electrónicos (CDR — Constancia de Recepción).
 *
 * LIVE PROOF: DEFERRED — requires SUNAT-accredited digital certificate + OSE contract.
 * All unit tests use a mocked OseHttpPort.
 *
 * Transmission flow:
 *   1. transmit(): find PE comprobante artifact → enviarComprobante() → ticket / immediate CDR.
 *   2. poll(): obtenerCdr() → map SUNAT codigoRespuesta → CLEARED/REJECTED/PENDING.
 *   3. unconfigured → SKIPPED.
 *
 * Ref format: "{companyId}|{tipoDoc}|{serie}|{correlativo}[|{ticket}]"
 */
export class OseTransmissionProvider implements TransmissionProvider {
  readonly id = 'ose';
  readonly channel: ChannelType = 'OSE';
  /** STUB — "OSE" is a market of interchangeable vendors (Nubefact, Facturalo.pe, …), each
   * with a different real API; this client models only the common denominator, so there is
   * no single real transport to target/prove. */
  readonly maturity: ProviderMaturity = 'STUB';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select',
        name: 'environment',
        label: 'OSE environment',
        required: true,
        options: [
          { label: 'Homologación (test)', value: 'test' },
          { label: 'Producción', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'baseUrl',
        label: 'OSE API base URL',
        placeholder: 'https://ose.example.pe',
        required: true,
      },
      { type: 'text', name: 'apiKey', label: 'OSE API key', required: true, secret: true },
      {
        type: 'text',
        name: 'ruc',
        label: 'RUC del emisor (11 dígitos)',
        placeholder: '20123456789',
        required: true,
        minLength: 11,
        maxLength: 11,
      },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: OseHttpPort,
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
      log.info('transmission/ose', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'OSE', status: 'SKIPPED', notes: ['ose: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const baseUrl = config.baseUrl as string;
    const apiKey = config.apiKey as string;
    const ruc = config.ruc as string;
    const environment = ((config.environment as string) ?? 'test').toLowerCase() as 'test' | 'prod';

    if (!baseUrl || !apiKey || !ruc) {
      return {
        channel: 'OSE',
        status: 'SKIPPED',
        notes: ['ose: incomplete config (baseUrl, apiKey, ruc required)'],
      };
    }

    // Find PE comprobante artifact (UBL 2.1 ZIP or signed XML ZIP)
    const comprobanteArtifact = artifacts.find((a) => a.syntax === 'PE_UBL');
    if (!comprobanteArtifact) {
      return { channel: 'OSE', status: 'SKIPPED', notes: ['ose: no PE_UBL artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'OSE', status: 'SKIPPED', notes: ['ose: no supplierCompanyId'] };
    }

    try {
      const { OseClient } = await import('./latam/ose-client.js');

      const http: OseHttpPort = this.httpPort ?? {
        enviarComprobante: async () => {
          throw new Error(
            'OSE transport not implemented — provide an OseHttpPort for your OSE (e.g. Nubefact, Facturalo.pe)',
          );
        },
        obtenerCdr: async () => {
          throw new Error('OSE transport not implemented — provide an OseHttpPort');
        },
      };

      const client = new OseClient(http, { environment, baseUrl, apiKey, ruc });

      const xmlZip =
        typeof comprobanteArtifact.bytes === 'string'
          ? Buffer.from(comprobanteArtifact.bytes, 'utf-8')
          : comprobanteArtifact.bytes instanceof Buffer
            ? comprobanteArtifact.bytes
            : Buffer.from(comprobanteArtifact.bytes);

      // Derive tipoDoc / serie / correlativo from key (placeholder; real derivation needs doc metadata)
      const tipoDoc: OseTipoDoc = '01'; // Factura — TODO derive from artifact metadata
      const serie = 'F001'; // TODO derive from invoice number
      const correlativo = key.slice(-6).replace(/\D/g, '0');

      log.info(
        'transmission/ose',
        `submitting to OSE (ruc ${ruc}, ${tipoDoc}-${serie}-${correlativo}, key ${key})`,
      );
      const resp = await client.enviarComprobante(tipoDoc, serie, correlativo, xmlZip);

      if (resp.estado === 'ACEPTADO') {
        const ref = `${companyId}|${tipoDoc}|${serie}|${correlativo}`;
        log.info('transmission/ose', `CDR accepted immediately (key ${key})`);
        return {
          channel: 'OSE',
          status: 'CLEARED',
          ref,
          notes: [`codigoRespuesta: ${resp.codigoRespuesta ?? '0'}`, resp.descripcion ?? 'Aceptado'].filter(
            Boolean,
          ),
        };
      }

      const ticket = resp.ticket;
      const ref = `${companyId}|${tipoDoc}|${serie}|${correlativo}${ticket ? `|${ticket}` : ''}`;
      log.info('transmission/ose', `submitted → ticket ${ticket ?? '(none)'} (key ${key})`);
      return {
        channel: 'OSE',
        status: 'PENDING',
        ref,
        notes: [`estado: ${resp.estado}`, `ticket: ${ticket}`].filter(Boolean),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/ose', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'OSE', status: 'REJECTED', notes: [`ose: transmit error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // Ref format: companyId|tipoDoc|serie|correlativo[|ticket]
    const parts = ref.split('|');
    if (parts.length < 4) {
      return { channel: 'OSE', status: 'PENDING', ref, notes: ['ose: invalid ref format'] };
    }
    const [companyId, tipoDoc, serie, correlativo, ticket] = parts;

    if (!this.credentials) {
      return { channel: 'OSE', status: 'PENDING', ref, notes: ['ose: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'ose');
      if (!resolved || !resolved.isActive) {
        return { channel: 'OSE', status: 'PENDING', ref, notes: ['ose: credentials no longer active'] };
      }

      const { config } = resolved;
      const baseUrl = config.baseUrl as string;
      const apiKey = config.apiKey as string;
      const ruc = config.ruc as string;
      const environment = ((config.environment as string) ?? 'test').toLowerCase() as 'test' | 'prod';

      const { OseClient } = await import('./latam/ose-client.js');
      const http: OseHttpPort = this.httpPort ?? {
        enviarComprobante: async () => {
          throw new Error('OSE transport not implemented');
        },
        obtenerCdr: async () => {
          throw new Error('OSE transport not implemented');
        },
      };

      const client = new OseClient(http, { environment, baseUrl, apiKey, ruc });

      log.info(
        'transmission/ose',
        `polling CDR (${tipoDoc}-${serie}-${correlativo}, ticket: ${ticket ?? 'none'})`,
      );
      const cdr = await client.obtenerCdr(tipoDoc as OseTipoDoc, serie, correlativo, ticket);

      const lifecycle =
        OseClient.mapEstado(cdr.estado) === 'CLEARED'
          ? 'CLEARED'
          : OseClient.mapCodigo(cdr.codigoRespuesta) === 'CLEARED'
            ? 'CLEARED'
            : OseClient.mapEstado(cdr.estado) === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING';

      const notes: string[] = [`codigoRespuesta: ${cdr.codigoRespuesta}`, cdr.descripcion];
      if (cdr.detalles?.length) {
        notes.push(...cdr.detalles.map((d) => `${d.codigo}: ${d.descripcion}`));
      }

      return { channel: 'OSE', status: lifecycle, ref, notes };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/ose', `poll failed: ${msg}`);
      return { channel: 'OSE', status: 'PENDING', ref, notes: [`ose: poll error: ${msg}`] };
    }
  }
}
