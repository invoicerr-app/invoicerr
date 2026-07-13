import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';
import type { BuyerDirectoryPort } from './buyer-directory-port';

/**
 * Map a free-text lifecycle status to a PDP XP Z12-012 lifecycle code (fr:xxx).
 *
 * Used by PdpTransmissionProvider.sendStatus() to translate internal status
 * strings ("encaissée", "accepted", etc.) to the canonical PDP codes.
 */
function mapStatusToPdpCode(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('encaiss') || s.includes('payment received') || s.includes('paid')) return 'fr:212'; // paiement reçu
  if (s.includes('payment sent') || s.includes('paiement envoyé')) return 'fr:211'; // paiement envoyé
  if (s.includes('accept') || s.includes('approv') || s.includes('approuv')) return 'fr:205'; // acceptée
  if (s.includes('refus') || s.includes('reject') || s.includes('rejet')) return 'fr:210'; // refusée
  if (s.includes('litige') || s.includes('disput') || s.includes('contesté')) return 'fr:207'; // litige
  // Default to "received" (fr:202) for unknown statuses
  return 'fr:202';
}

/** France — Plateforme de Dématérialisation Partenaire (+ PPF annuaire routing). */
export class PdpTransmissionProvider implements TransmissionProvider {
  readonly id = 'pdp';
  readonly channel: ChannelType = 'PDP';
  /** PROVEN — real invoice PENDING in superpdp sandbox, verified end-to-end (2026-06-28). */
  readonly maturity: ProviderMaturity = 'PROVEN';
  readonly feedback = 'ASYNC_CALLBACK' as const; // PDP pushes lifecycle statuses (déposée/refusée/encaissée); poll() is the fallback
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'text',
        name: 'baseUrl',
        label: 'API base URL',
        placeholder: 'https://api.superpdp.tech',
        required: true,
      },
      { type: 'text', name: 'clientId', label: 'Client ID', required: true },
      { type: 'text', name: 'clientSecret', label: 'Client secret', required: true, secret: true },
      {
        type: 'select',
        name: 'environment',
        label: 'Environment',
        required: true,
        options: [
          { label: 'Test (sandbox)', value: 'TEST' },
          { label: 'Production', value: 'PROD' },
        ],
        default: 'TEST',
      },
      {
        type: 'select',
        name: 'apiStyle',
        label: 'API style',
        required: false,
        options: [
          { label: 'SuperPDP (proprietary)', value: 'superpdp' },
          { label: 'AFNOR Flow (XP Z12-013)', value: 'afnor' },
        ],
        default: 'superpdp',
      },
      // The company's OWN routing address on its PDP: {pdp_siren}_{account_id}. The buyer's
      // endpoint is resolved per-invoice from the client/annuaire — not configured here.
      {
        type: 'text',
        name: 'sellerEndpointId',
        label: 'Your PDP routing ID',
        placeholder: '315143296_1422',
        required: false,
      },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Optional AFNOR Directory seam to resolve buyer endpoint when not in config. */
    private readonly buyerDirectory?: BuyerDirectoryPort,
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
      log.info('transmission/pdp', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'PDP', status: 'SKIPPED', notes: ['pdp: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const baseUrl = config.baseUrl as string;
    const clientId = config.clientId as string;
    const clientSecret = config.clientSecret as string;
    const apiStyle = (config.apiStyle as string) ?? 'superpdp';

    if (!baseUrl || !clientId || !clientSecret) {
      return {
        channel: 'PDP',
        status: 'SKIPPED',
        notes: ['pdp: incomplete config (baseUrl, clientId, clientSecret required)'],
      };
    }

    // Prefer EN16931_CII (raw CII XML for CTC) over FACTURX (may be PDF/A-3)
    const ciiArtifact = artifacts.find((a) => a.syntax === 'EN16931_CII');
    const facturxArtifact = ciiArtifact ?? artifacts.find((a) => a.syntax === 'FACTURX');
    if (!facturxArtifact) {
      return { channel: 'PDP', status: 'SKIPPED', notes: ['pdp: no CII or FACTURX artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'PDP', status: 'SKIPPED', notes: ['pdp: no supplierCompanyId in context'] };
    }

    try {
      const { PdpClient } = await import('./pdp/pdp-client.js');

      const client = new PdpClient({
        baseUrl,
        clientId,
        clientSecret,
        apiStyle: apiStyle as 'superpdp' | 'afnor',
      });

      let rawBytes =
        typeof facturxArtifact.bytes === 'string'
          ? Buffer.from(facturxArtifact.bytes, 'utf-8')
          : facturxArtifact.bytes instanceof Buffer
            ? facturxArtifact.bytes
            : Buffer.from(facturxArtifact.bytes);

      // CTC FR post-processing: inject SpecifiedLegalOrganization/ID into CII XML
      // @e-invoice-eu/core emits SpecifiedLegalOrganization when cbc:CompanyID@schemeID='0002' is set.
      const { postProcessCiiForCtc } = await import('../../schemas/cii-post-process.js');
      const first4 = String.fromCharCode(rawBytes[0], rawBytes[1], rawBytes[2], rawBytes[3]);
      if (first4.startsWith('<') || rawBytes[0] === 0x3c) {
        const originalXml = rawBytes.toString('utf-8');
        // sellerEndpointId / buyerEndpointId come from company channel config.
        // Format: {pdp_siren}_{account_id} — NOT the company's SIREN.
        const sellerRouting = config.sellerEndpointId as string | undefined;
        let buyerRouting = config.buyerEndpointId as string | undefined;

        // §7 — resolve buyer endpoint from AFNOR Directory when not pre-configured.
        if (!buyerRouting && this.buyerDirectory) {
          const buyerSiren = ctx.buyer.identifiers?.find(
            (id) => id.scheme === 'SIREN' || id.scheme === 'SIRET',
          )?.value;
          if (buyerSiren) {
            try {
              const dirResult = await this.buyerDirectory.lookup({ identifier: buyerSiren });
              if (dirResult) {
                buyerRouting = dirResult.endpointId;
                log.info(
                  'transmission/pdp',
                  `AFNOR directory resolved buyer ${buyerSiren} → ${buyerRouting} (key ${key})`,
                );
              }
            } catch {
              // Directory lookup failed — proceed without buyer routing (non-blocking).
            }
          }
        }

        const patched = postProcessCiiForCtc(originalXml, { sellerRouting, buyerRouting });
        if (patched !== originalXml) {
          log.info(
            'transmission/pdp',
            `CTC post-processing: injected SpecifiedLegalOrganization (key ${key})`,
          );
          rawBytes = Buffer.from(patched, 'utf-8');
        }
      }

      log.info('transmission/pdp', `authenticating (key ${key})`);
      await client.authenticate();

      if (apiStyle === 'afnor') {
        // AFNOR Flow API path
        log.info('transmission/pdp', `submitting flow via AFNOR API (key ${key})`);
        const flow = await client.submitFlow(rawBytes, {
          flowSyntax: 'Factur-X',
          flowProfile: 'Extended-CTC-FR',
          name: ctx.externalRef ?? `invoice-${key}`,
          // processingRule omitted: superpdp's AFNOR Flux sandbox rejects it (501 not yet supported).
          trackingId: key,
        });

        const ref = `${companyId}|${flow.flowId}`;
        log.info('transmission/pdp', `flow submitted → ${flow.flowId} (key ${key})`);
        return { channel: 'PDP', status: 'PENDING', ref, notes: [`flowId: ${flow.flowId}`] };
      }

      // SuperPDP proprietary API path (default)
      log.info('transmission/pdp', `submitting invoice via SuperPDP API (key ${key})`);
      const invoice = await client.sendInvoice(rawBytes, {
        externalId: key,
        disablePreCheck: false,
      });

      const ref = `${companyId}|${invoice.id}`;
      log.info('transmission/pdp', `invoice submitted → id ${invoice.id} (key ${key})`);
      return { channel: 'PDP', status: 'PENDING', ref, notes: [`invoiceId: ${invoice.id}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/pdp', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'PDP', status: 'REJECTED', notes: [`pdp: transmit error: ${msg}`] };
    }
  }

  async sendStatus(
    ref: string,
    status: string,
    _ctx: TransactionContext,
    _plan: CompliancePlan,
    log: ComplianceLogger,
  ): Promise<TransmissionResult> {
    // Push a lifecycle status (XP Z12-012 lifecycle code) to the PDP for a previously deposited
    // invoice. Typical callers: markPaid() emitting "encaissée" (fr:212 = paiement reçu).
    //
    // Ref format: "companyId|invoiceId" (SuperPDP) or "companyId|flowId" (AFNOR).
    //
    // LIVE PROOF: Deferred — endpoint needs live SuperPDP sandbox verification.
    // The SuperPDP proprietary API exposes POST /v1.beta/invoices/{id}/lifecycle_events
    // for seller-side status pushes (payment received, etc.).

    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'PDP', status: 'QUEUED', ref, notes: ['pdp: invalid ref for sendStatus'] };
    }
    const [companyId, invoiceIdOrFlowId] = parts;

    if (!this.credentials) {
      return { channel: 'PDP', status: 'QUEUED', ref, notes: ['pdp: no credentials port for sendStatus'] };
    }

    const resolved = await this.credentials.resolveActive(companyId, 'pdp');
    if (!resolved?.isActive) {
      return { channel: 'PDP', status: 'QUEUED', ref, notes: ['pdp: credentials no longer active'] };
    }

    const { config } = resolved;
    const baseUrl = config.baseUrl as string;
    const clientId = config.clientId as string;
    const clientSecret = config.clientSecret as string;
    const apiStyle = (config.apiStyle as string) ?? 'superpdp';

    if (!baseUrl || !clientId || !clientSecret) {
      return { channel: 'PDP', status: 'QUEUED', ref, notes: ['pdp: incomplete config for sendStatus'] };
    }

    try {
      const { PdpClient } = await import('./pdp/pdp-client.js');
      const client = new PdpClient({
        baseUrl,
        clientId,
        clientSecret,
        apiStyle: apiStyle as 'superpdp' | 'afnor',
      });
      client.clearToken();
      await client.authenticate();

      // Map the lifecycle status text to a PDP XP Z12-012 code.
      const pdpCode = mapStatusToPdpCode(status);

      if (apiStyle === 'afnor') {
        // AFNOR Flow does not define a seller-side lifecycle push endpoint in the v1 spec.
        log.todo(
          'transmission/pdp',
          `sendStatus AFNOR: flow "${invoiceIdOrFlowId}" status "${status}" (code ${pdpCode}) — no standard endpoint yet`,
        );
        return {
          channel: 'PDP',
          status: 'QUEUED',
          ref,
          notes: [`pdp: AFNOR sendStatus deferred (no v1 endpoint); would push ${pdpCode}`],
        };
      }

      // SuperPDP: POST /v1.beta/invoices/{id}/lifecycle_events { code }
      const invoiceId = parseInt(invoiceIdOrFlowId, 10);
      if (Number.isNaN(invoiceId)) {
        return {
          channel: 'PDP',
          status: 'QUEUED',
          ref,
          notes: [`pdp: invalid invoiceId in ref: ${invoiceIdOrFlowId}`],
        };
      }

      log.info(
        'transmission/pdp',
        `sendStatus: pushing "${pdpCode}" for invoiceId ${invoiceId} (ref ${ref})`,
      );
      await client.pushLifecycleStatus(invoiceId, pdpCode);
      return {
        channel: 'PDP',
        status: 'SENT',
        ref,
        notes: [`pushed lifecycle code: ${pdpCode} (input: "${status}")`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/pdp', `sendStatus failed: ${msg} (ref ${ref})`);
      return { channel: 'PDP', status: 'QUEUED', ref, notes: [`pdp: sendStatus error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // Parse ref: companyId|invoiceId or companyId|flowId
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'PDP', status: 'PENDING', ref, notes: ['pdp: invalid ref format'] };
    }
    const [companyId, invoiceId] = parts;

    if (!this.credentials) {
      return { channel: 'PDP', status: 'PENDING', ref, notes: ['pdp: no credentials port'] };
    }

    try {
      // Re-resolve credentials from persisted config (survives restarts — KSeF lesson)
      const resolved = await this.credentials.resolveActive(companyId, 'pdp');
      if (!resolved || !resolved.isActive) {
        return { channel: 'PDP', status: 'PENDING', ref, notes: ['pdp: credentials no longer active'] };
      }

      const { config } = resolved;
      const baseUrl = config.baseUrl as string;
      const clientId = config.clientId as string;
      const clientSecret = config.clientSecret as string;
      const apiStyle = (config.apiStyle as string) ?? 'superpdp';

      const { PdpClient } = await import('./pdp/pdp-client.js');
      const client = new PdpClient({
        baseUrl,
        clientId,
        clientSecret,
        apiStyle: apiStyle as 'superpdp' | 'afnor',
      });

      // Force re-auth (no in-memory cache as source of truth)
      client.clearToken();
      await client.authenticate();

      if (apiStyle === 'afnor') {
        return this.pollAfnor(client, invoiceId, ref, log);
      }

      return this.pollSuperPdp(client, invoiceId, ref, log);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/pdp', `poll failed: ${msg}`);
      return { channel: 'PDP', status: 'PENDING', ref, notes: [`pdp: poll error: ${msg}`] };
    }
  }

  private async pollSuperPdp(
    client: { getInvoice(id: number): Promise<{ status_code?: string[] }> },
    invoiceId: string,
    ref: string,
    _log: ComplianceLogger,
  ): Promise<TransmissionResult> {
    const id = parseInt(invoiceId, 10);
    if (Number.isNaN(id)) {
      return { channel: 'PDP', status: 'PENDING', ref, notes: ['pdp: invalid invoice id'] };
    }

    const invoice = await client.getInvoice(id);
    const latestStatus = invoice.status_code?.[invoice.status_code.length - 1];

    if (!latestStatus) {
      return { channel: 'PDP', status: 'PENDING', ref, notes: ['pdp: no status codes'] };
    }

    // Map SuperPDP status codes to lifecycle outcomes
    return this.mapSuperPdpStatus(latestStatus, ref, invoice.status_code);
  }

  private async pollAfnor(
    client: {
      getFlow(flowId: string): Promise<{
        flowId: string;
        acknowledgement?: { status: string; details?: Array<{ reasonCode: string; reasonMessage: string }> };
      }>;
    },
    flowId: string,
    ref: string,
    _log: ComplianceLogger,
  ): Promise<TransmissionResult> {
    const flow = await client.getFlow(flowId);
    const ack = flow.acknowledgement?.status;

    if (ack === 'Ok') {
      return { channel: 'PDP', status: 'CLEARED', ref, notes: [`flowId: ${flowId}`] };
    }
    if (ack === 'Error') {
      const details =
        flow.acknowledgement?.details?.map((d) => `${d.reasonCode}: ${d.reasonMessage}`).join('; ') ?? '';
      return {
        channel: 'PDP',
        status: 'REJECTED',
        ref,
        notes: [`pdp: flow rejected${details ? ` — ${details}` : ''}`],
      };
    }
    // Pending or unknown
    return { channel: 'PDP', status: 'PENDING', ref, notes: [`ack: ${ack ?? 'unknown'}`] };
  }

  /** Map SuperPDP proprietary status codes to TransmissionResult status. */
  private mapSuperPdpStatus(status: string, ref: string, allStatuses?: string[]): TransmissionResult {
    const notes: string[] = [];
    if (allStatuses?.length) notes.push(`statuses: ${allStatuses.join(', ')}`);

    // --- fr:* lifecycle statuses (XP Z12-012) ---
    // fr:200 = Submitted, fr:201 = Sent, fr:202 = Received,
    // fr:203 = Made available, fr:204 = Acknowledged
    if (['fr:200', 'fr:201', 'fr:202', 'fr:203', 'fr:204'].includes(status)) {
      return { channel: 'PDP', status: 'PENDING', ref, notes };
    }
    // fr:205 = Accepted, fr:206 = Partly accepted, fr:209 = Completed
    if (['fr:205', 'fr:206', 'fr:209'].includes(status)) {
      return { channel: 'PDP', status: 'CLEARED', ref, notes };
    }
    // fr:207 = Disputed, fr:208 = On hold — still pending, not terminal
    if (['fr:207', 'fr:208'].includes(status)) {
      return { channel: 'PDP', status: 'PENDING', ref, notes };
    }
    // fr:210 = Refused, fr:213 = Rejected, fr:501 = Inadmissible
    if (['fr:210', 'fr:213', 'fr:501'].includes(status)) {
      return { channel: 'PDP', status: 'REJECTED', ref, notes };
    }
    // fr:211 = Payment sent, fr:212 = Payment received → cleared
    if (['fr:211', 'fr:212'].includes(status)) {
      return { channel: 'PDP', status: 'CLEARED', ref, notes };
    }

    // --- api:* statuses (SuperPDP internal) ---
    if (['api:uploaded', 'api:validated', 'api:sent', 'api:received', 'api:acknowledged'].includes(status)) {
      return { channel: 'PDP', status: 'PENDING', ref, notes };
    }
    if (status === 'api:accepted') {
      return { channel: 'PDP', status: 'CLEARED', ref, notes };
    }
    if (['api:invalid', 'api:rejected'].includes(status)) {
      return { channel: 'PDP', status: 'REJECTED', ref, notes };
    }

    // Unknown status — stay pending
    return { channel: 'PDP', status: 'PENDING', ref, notes: [...notes, `unknown status: ${status}`] };
  }
}
