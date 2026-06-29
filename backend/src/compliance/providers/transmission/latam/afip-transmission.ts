/**
 * Argentina AFIP/ARCA transmission provider — scaffold, live-deferred.
 *
 * Wraps AfipClient to implement the TransmissionProvider interface.
 * Auth flow: WSAA TA (12h token) → WSFE FECAESolicitar → CAE.
 * Ref format: "{companyId}|{cbteDesde}|{puntoVenta}|{tipoComprobante}"
 *
 * LIVE PROOF: DEFERRED — no public AFIP test CUIT + cert available.
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { AfipClient, AfipHttpPort } from './afip-client';

export class AfipTransmissionProvider implements TransmissionProvider {
  readonly id = 'afip';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'AFIP environment', required: true,
        options: [{ label: 'Homologación (test)', value: 'test' }, { label: 'Producción', value: 'prod' }],
        default: 'test' },
      { type: 'text', name: 'cuit', label: 'CUIT (digits only, no dashes)', placeholder: '30712345679',
        required: true, minLength: 11, maxLength: 11 },
      { type: 'text', name: 'puntoVenta', label: 'Punto de Venta (1-9999)',
        placeholder: '1', required: true },
      { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)',
        required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password',
        required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Inject a mock AfipHttpPort for tests. */
    private readonly httpPort?: AfipHttpPort,
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
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['afip: no resolved config'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'test').toLowerCase() as 'test' | 'prod';
    const cuit = config.cuit as string;
    const puntoVenta = parseInt(String(config.puntoVenta ?? '1'), 10);

    if (!cuit) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['afip: cuit required'] };
    }

    // Find AR_FE artifact
    const arArtifact = artifacts.find((a) => a.syntax === 'AR_FE');
    if (!arArtifact) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['afip: no AR_FE artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['afip: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStubHttpPort();

    try {
      const client = new AfipClient(http, {
        environment: env,
        cuit,
        certBase64: config.certBase64 as string | undefined,
        certPassword: config.certPassword as string | undefined,
      });

      log.info('transmission/afip', `authenticating WSAA (CUIT ${cuit}, key ${key})`);
      const issueDate = ctx.issueDate?.toISOString().split('T')[0].replace(/-/g, '') ??
        new Date().toISOString().split('T')[0].replace(/-/g, '');

      // Build a minimal CAE request from the transaction context
      const total = ctx.lines.reduce((s, l) => s + l.unitNetMinor * l.quantity, 0) / 100;
      const iva = total * 0.21; // TODO: use real VAT from ctx

      const caeResp = await client.submitComprobante({
        cuit,
        puntoVenta: isNaN(puntoVenta) ? 1 : puntoVenta,
        tipoComprobante: 6, // Factura B (default; derive from buyer type in real integration)
        numero: 1, // TODO: from comprobante sequence
        fechaComprobante: issueDate,
        importeGravado: parseFloat(total.toFixed(2)),
        importeIva: parseFloat(iva.toFixed(2)),
        importeTotal: parseFloat((total + iva).toFixed(2)),
        cuitReceptor: ctx.buyer.identifiers.find((i) => i.scheme === 'VAT')?.value?.replace(/\D/g, '') ?? '0',
        ivaItems: [{ id: 5, baseImponible: parseFloat(total.toFixed(2)), importe: parseFloat(iva.toFixed(2)) }],
      });

      if (caeResp.resultado === 'R') {
        const errors = caeResp.errores?.map((e) => `${e.code}: ${e.msg}`).join('; ') ?? '';
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`afip: CAE rechazado — ${errors}`] };
      }

      // AFIP returns CAE synchronously — CLEARED immediately
      const ref = `${companyId}|${caeResp.cbteDesde}|${puntoVenta}|6`;
      log.info('transmission/afip', `CAE ${caeResp.cae} issued, valid until ${caeResp.vencimientoCAE} (key ${key})`);
      return {
        channel: 'GOV_PORTAL_API',
        status: 'CLEARED',
        ref,
        authorityIds: [{ scheme: 'CAE', value: caeResp.cae }],
        notes: [`CAE: ${caeResp.cae}`, `vencimiento: ${caeResp.vencimientoCAE}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/afip', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`afip: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // AFIP returns CAE synchronously (transmit → CLEARED) — poll() is rarely needed
    // but provides a re-check path for edge cases (partial authorization).
    // Ref: "{companyId}|{cbteDesde}|{puntoVenta}|{tipoComprobante}"
    log.todo('transmission/afip', `poll AFIP comprobante status for ref ${ref} — use FECompConsultar`);
    return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['afip: poll deferred (use FECompConsultar)'] };
  }
}

/** Stub that throws clearly when no httpPort is injected (no real credentials). */
function buildStubHttpPort(): AfipHttpPort {
  return {
    authenticate: async () => {
      throw new Error('AfipHttpPort not implemented — AFIP WSAA PKCS#12 + live CUIT required');
    },
    fecaeSolicitar: async () => {
      throw new Error('AfipHttpPort not implemented — AFIP WSFE credentials required');
    },
    serverStatus: async () => {
      throw new Error('AfipHttpPort not implemented');
    },
  };
}
