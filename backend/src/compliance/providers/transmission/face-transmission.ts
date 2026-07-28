/**
 * Spain — FACe (Punto General de Entrada de Facturas Electrónicas) B2G transmission provider.
 *
 * See face-client.ts for the full SSPP contract writeup (endpoints, operations, WS-Security
 * signing scheme, estado code table) and its sources. Summary:
 *   - GOV_PORTAL_API / providerId 'es-face', selected explicitly by es.ts (mirrors FR's
 *     choruspro: B2G supplier configures FACe credentials, everyone else skips it for lack of
 *     credentials — see es.ts and fr.ts NOTE comments).
 *   - feedback: ASYNC_POLL — enviarFactura registers the invoice (→ PENDING), poll() calls
 *     consultarFactura to learn the tramitación estado (→ CLEARED/REJECTED/PENDING).
 *   - maturity: IMPLEMENTED — the SSPP SOAP contract (operation names, request/response field
 *     shapes, estado code table) is real and unit-tested against literal example XML from
 *     official-pattern sources. What's deferred is the WS-Security XML-DSig signing itself
 *     (requires a live FACe-registered certificate to validate — see face-client.ts header) via
 *     the injectable FaceHttpPort, exactly like SdiTransmissionProvider defers SdI's mTLS/PFX.
 *   - HONESTY GUARD (COMPLIANCE_AUDIT.md F-6/F-8/M-18): when no FaceHttpPort is injected,
 *     transmit() returns SKIPPED explicitly — never SENT/PENDING. Nothing is ever attempted
 *     without a real transport; there is no throw-and-catch-into-REJECTED fallback that could
 *     look like a genuine attempt.
 */
import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { AuthorityIdentifier, SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';
import { FACE_ENDPOINTS, FaceClient, FaceHttpPort, mapFaceEstado } from './face-client';

const GP: ChannelType = 'GOV_PORTAL_API';

const FACE_CONFIG_SCHEMA: ChannelConfigSchema = {
  fields: [
    {
      type: 'select',
      name: 'environment',
      label: 'Environment',
      required: true,
      options: [
        { label: 'Sandbox (se-face-webservice.redsara.es)', value: 'test' },
        { label: 'Production (webservice.face.gob.es)', value: 'prod' },
      ],
      default: 'test',
    },
    // The SSPP web service is authenticated with WS-Security X.509 signing, not a bearer
    // token: every request/response is signed with the company's own FACe-registered
    // certificate (see face-client.ts header). NOT the DIR3 codes (órgano gestor / unidad
    // tramitadora / oficina contable) — those are embedded in the Facturae XML's
    // <AdministrativeCentres> block by the format layer, not passed to this web service call.
    {
      type: 'text',
      name: 'certificate',
      label: 'FACe client certificate (PKCS#12, base64)',
      required: true,
      secret: true,
    },
    {
      type: 'text',
      name: 'certificatePassword',
      label: 'Certificate password',
      required: true,
      secret: true,
    },
    {
      type: 'text',
      name: 'notificationEmail',
      label: 'Notification email (correo)',
      placeholder: 'facturacion@empresa.es',
      required: true,
    },
  ],
};

/** Spain — FACe B2G invoice entry point (Ley 25/2013), selected via providerId='es-face'. */
export class FaceTransmissionProvider implements TransmissionProvider {
  readonly id = 'es-face';
  readonly channel: ChannelType = GP;
  /** IMPLEMENTED — real SSPP envelope/estado contract, awaiting a FACe-registered certificate. */
  readonly maturity: ProviderMaturity = 'IMPLEMENTED';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 120, timeoutHours: 96, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = FACE_CONFIG_SCHEMA;

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Inject a real/mocked FaceHttpPort; undefined ⇒ transmit() SKIPS (F-6/F-8 honesty guard). */
    private readonly httpPort?: FaceHttpPort,
  ) {}

  private resolveEndpoint(config: Record<string, unknown>, environment?: string): string {
    const envKey = String(config.environment ?? environment ?? 'test') === 'prod' ? 'prod' : 'test';
    return FACE_ENDPOINTS[envKey];
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
      log.info('transmission/es-face', `no resolved config for company — skipping (key ${key})`);
      return { channel: GP, status: 'SKIPPED', notes: ['es-face: no resolved config'] };
    }

    const { config, environment } = resolvedConfig;
    const certificate = config.certificate as string | undefined;
    const certificatePassword = config.certificatePassword as string | undefined;
    const notificationEmail = config.notificationEmail as string | undefined;

    if (!certificate || !certificatePassword || !notificationEmail) {
      return {
        channel: GP,
        status: 'SKIPPED',
        notes: ['es-face: incomplete config (certificate, certificatePassword, notificationEmail required)'],
      };
    }

    // F-6/F-8 honesty guard: no real transport wired ⇒ SKIPPED, never SENT/PENDING. This is the
    // one thing this file deliberately never attempts — see face-client.ts header for why.
    if (!this.httpPort) {
      log.warn(
        'transmission/es-face',
        `no FaceHttpPort configured — WS-Security signed SSPP transport not wired (key ${key})`,
      );
      return {
        channel: GP,
        status: 'SKIPPED',
        notes: [
          'es-face: no FaceHttpPort configured — a real certificate + WS-Security XML-DSig ' +
            'signing implementation is required (see face-client.ts header for the exact SSPP contract)',
        ],
      };
    }

    const artifact = artifacts.find((a) => a.syntax === 'ES_FACTURAE');
    if (!artifact) {
      return { channel: GP, status: 'SKIPPED', notes: ['es-face: no ES_FACTURAE artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: GP, status: 'SKIPPED', notes: ['es-face: no supplierCompanyId in context'] };
    }

    const endpoint = this.resolveEndpoint(config, environment);
    const client = new FaceClient({ endpoint }, this.httpPort);
    const bytes = Buffer.isBuffer(artifact.bytes) ? artifact.bytes : Buffer.from(artifact.bytes);
    const facturaBase64 = bytes.toString('base64');
    const facturaNombre = `invoice-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml`;

    log.info('transmission/es-face', `enviarFactura to FACe SSPP (key ${key}, file ${facturaNombre})`);

    try {
      const result = await client.enviarFactura({
        correo: notificationEmail,
        facturaBase64,
        facturaNombre,
      });

      if (result.codigo !== '0') {
        log.warn(
          'transmission/es-face',
          `enviarFactura rejected — codigo ${result.codigo}: ${result.descripcion} (key ${key})`,
        );
        return {
          channel: GP,
          status: 'REJECTED',
          notes: [`es-face: enviarFactura error ${result.codigo}: ${result.descripcion}`],
        };
      }

      if (!result.numeroRegistro) {
        return {
          channel: GP,
          status: 'REJECTED',
          notes: ['es-face: enviarFactura succeeded but returned no numeroRegistro'],
        };
      }

      const ref = `${companyId}|${result.numeroRegistro}`;
      log.info('transmission/es-face', `registered — numeroRegistro ${result.numeroRegistro} (key ${key})`);
      const authorityIds: AuthorityIdentifier[] = [
        { scheme: 'FACE_NUMERO_REGISTRO', value: result.numeroRegistro },
      ];
      return {
        channel: GP,
        status: 'PENDING',
        ref,
        authorityIds,
        notes: [`numeroRegistro: ${result.numeroRegistro}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/es-face', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`es-face: transmit error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const sep = ref.indexOf('|');
    if (sep < 0) {
      return { channel: GP, status: 'PENDING', ref, notes: ['es-face: invalid ref format'] };
    }
    const companyId = ref.slice(0, sep);
    const numeroRegistro = ref.slice(sep + 1);

    if (!this.credentials) {
      return { channel: GP, status: 'PENDING', ref, notes: ['es-face: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'es-face');
      if (!resolved?.isActive) {
        return { channel: GP, status: 'PENDING', ref, notes: ['es-face: credentials no longer active'] };
      }

      if (!this.httpPort) {
        return { channel: GP, status: 'PENDING', ref, notes: ['es-face: no FaceHttpPort configured'] };
      }

      const endpoint = this.resolveEndpoint(resolved.config, resolved.environment);
      const client = new FaceClient({ endpoint }, this.httpPort);
      const result = await client.consultarFactura(numeroRegistro);

      if (result.codigo !== '0') {
        return {
          channel: GP,
          status: 'PENDING',
          ref,
          notes: [`es-face: consultarFactura error ${result.codigo}: ${result.descripcion}`],
        };
      }

      const status = mapFaceEstado(result.tramitacion?.codigo);
      const notes = [
        `tramitacion: ${result.tramitacion?.codigo ?? 'unknown'} (${result.tramitacion?.descripcion ?? ''})`,
      ];
      if (result.anulacion && result.anulacion.codigo !== '4100') {
        notes.push(`anulacion: ${result.anulacion.codigo} (${result.anulacion.descripcion})`);
      }
      log.info('transmission/es-face', `consultarFactura → ${notes[0]} → ${status} (ref ${ref})`);
      return { channel: GP, status, ref, notes };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/es-face', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`es-face: poll error: ${msg}`] };
    }
  }
}
