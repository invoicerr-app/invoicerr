import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from './transmission-provider';
import type { PeppolApPort } from './peppol/peppol-client';
import type { SmpLookupPort } from './peppol/smp-client';
import type { BuyerDirectoryPort } from './buyer-directory-port';

/**
 * Peppol 4-corner transmission provider.
 *
 * LIVE PROOF: DEFERRED — requires a Peppol-connected Access Point (production or
 * OpenPeppol AccAP test environment) with a valid AP certificate and network agreement.
 * All unit tests use a mocked PeppolApPort and SmpLookupPort.
 *
 * Transmission flow:
 *   1. SMP/SML lookup: DNS → SMP → receiver's AP endpoint URL (mocked in tests).
 *   2. AP HTTP send: POST document to configured AP gateway (wraps AS4/ebMS3).
 *   3. poll(): GET status from AP gateway → map delivery/MLR to lifecycle.
 *
 * Ref format: "{companyId}|{messageId}"
 */
export class PeppolTransmissionProvider implements TransmissionProvider {
  readonly id = 'peppol';
  readonly channel: ChannelType = 'PEPPOL';
  readonly feedback = 'ASYNC_CALLBACK' as const; // Peppol Invoice Response / MLR
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'Environment', required: true, options: [
        { label: 'Test (OpenPeppol AccAP)', value: 'TEST' },
        { label: 'Production', value: 'PROD' },
      ], default: 'TEST' },
      { type: 'text', name: 'participantId', label: 'Your Peppol ID', placeholder: '0009:12345678900011', required: true },
      { type: 'text', name: 'accessPointUrl', label: 'Access Point gateway URL', placeholder: 'https://ap.example.com', required: true },
      { type: 'text', name: 'apiKey', label: 'Access Point API key', required: true, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Inject mocks for tests; production uses the real HTTP implementations. */
    private readonly apPort?: PeppolApPort,
    private readonly smpPort?: SmpLookupPort,
    /**
     * §179 — optional directory for resolving the buyer's Peppol participant ID
     * when it is not pre-configured in ctx.buyer.peppolId.
     * Falls back gracefully to SKIPPED when the directory returns null.
     */
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
      log.info('transmission/peppol', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'PEPPOL', status: 'SKIPPED', notes: ['peppol: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const senderParticipantId = config.participantId as string;
    const accessPointUrl = config.accessPointUrl as string;
    const apiKey = config.apiKey as string;
    const environment = (config.environment as string ?? 'TEST') as 'TEST' | 'PROD';

    if (!senderParticipantId || !accessPointUrl || !apiKey) {
      return { channel: 'PEPPOL', status: 'SKIPPED', notes: ['peppol: incomplete config (participantId, accessPointUrl, apiKey required)'] };
    }

    // Determine receiver participant ID from ctx.
    // §179: when peppolId is absent but buyer has a PEPPOL identifier, resolve via directory.
    let receiverPeppolId = ctx.buyer.peppolId;
    if (!receiverPeppolId && this.buyerDirectory) {
      const peppolIdentifier = ctx.buyer.identifiers?.find(
        (id) => id.scheme === 'PEPPOL' || id.scheme === 'PEPPOL_ID',
      );
      if (peppolIdentifier) {
        try {
          const dirResult = await this.buyerDirectory.lookup({
            identifier: peppolIdentifier.value,
            scheme: 'PEPPOL_ID',
            environment,
          });
          if (dirResult) {
            receiverPeppolId = dirResult.endpointId;
            log.info('transmission/peppol', `directory resolved buyer ${peppolIdentifier.value} → ${receiverPeppolId} (key ${key})`);
          }
        } catch {
          // Directory unavailable — proceed without peppolId (non-blocking).
        }
      }
    }

    if (!receiverPeppolId) {
      return { channel: 'PEPPOL', status: 'SKIPPED', notes: ['peppol: buyer has no peppolId — cannot route'] };
    }

    // Find UBL or CII artifact (PEPPOL_BIS preferred, then EN16931_UBL, then EN16931_CII)
    const documentArtifact = artifacts.find((a) => a.syntax === 'PEPPOL_BIS')
      ?? artifacts.find((a) => a.syntax === 'EN16931_UBL')
      ?? artifacts.find((a) => a.syntax === 'EN16931_CII');

    if (!documentArtifact) {
      return { channel: 'PEPPOL', status: 'SKIPPED', notes: ['peppol: no PEPPOL_BIS, EN16931_UBL, or EN16931_CII artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'PEPPOL', status: 'SKIPPED', notes: ['peppol: no supplierCompanyId'] };
    }

    try {
      const { PeppolApHttpClient, PEPPOL_BILLING_PROCESS_ID, PEPPOL_DOC_TYPES } = await import('./peppol/peppol-client.js');
      const { DnsSmpLookup } = await import('./peppol/smp-client.js');

      // Parse receiver participant ID: icd:identifier
      const [receiverIcd, receiverIdentifier] = receiverPeppolId.split(':');
      if (!receiverIcd || !receiverIdentifier) {
        return { channel: 'PEPPOL', status: 'SKIPPED', notes: [`peppol: invalid receiverPeppolId format (expected icd:identifier): ${receiverPeppolId}`] };
      }

      // SMP lookup to confirm the receiver is registered and find their AP endpoint
      const smp = this.smpPort ?? new DnsSmpLookup();
      const docTypeId = PEPPOL_DOC_TYPES.INVOICE_UBL;

      log.info('transmission/peppol', `SMP lookup for receiver ${receiverPeppolId} (key ${key})`);
      const smpResult = await smp.lookup(
        { icd: receiverIcd, identifier: receiverIdentifier },
        docTypeId,
        environment,
      );

      if (!smpResult) {
        return { channel: 'PEPPOL', status: 'SKIPPED', notes: [`peppol: receiver ${receiverPeppolId} not found in SMP — not registered on Peppol`] };
      }

      log.info('transmission/peppol', `SMP resolved → AP endpoint: ${smpResult.endpoint.url} (key ${key})`);

      const documentBytes = typeof documentArtifact.bytes === 'string'
        ? Buffer.from(documentArtifact.bytes, 'utf-8')
        : documentArtifact.bytes instanceof Buffer
          ? documentArtifact.bytes
          : Buffer.from(documentArtifact.bytes);

      // Submit via AP gateway
      const ap = this.apPort ?? new PeppolApHttpClient({ accessPointUrl, apiKey, environment });
      log.info('transmission/peppol', `submitting to AP gateway ${accessPointUrl} (key ${key})`);
      const sendResult = await ap.send({
        senderParticipantId,
        receiverParticipantId: receiverPeppolId,
        documentTypeId: docTypeId,
        processId: PEPPOL_BILLING_PROCESS_ID,
        documentBytes,
        idempotencyKey: key,
      });

      const ref = `${companyId}|${sendResult.messageId}`;
      log.info('transmission/peppol', `submitted → messageId ${sendResult.messageId} (key ${key})`);
      return { channel: 'PEPPOL', status: 'PENDING', ref, notes: [`messageId: ${sendResult.messageId}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/peppol', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'PEPPOL', status: 'REJECTED', notes: [`peppol: transmit error: ${msg}`] };
    }
  }

  async sendStatus(ref: string, status: string, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<TransmissionResult> {
    // Peppol Invoice Response (IMR / BIS 3 CIUS / BIS 36a MLR).
    // Called when WE are the buyer confirming acceptance/rejection of a received invoice,
    // OR when the seller's AP relays our response back through the 4-corner network.
    //
    // LIVE PROOF: DEFERRED — requires a connected Access Point (AccAP or production AP).
    //
    // The response code mapping:
    //   accept / approved / cleared → AB (Invoice Accepted)
    //   refuse / reject             → RE (Invoice Rejected)
    //   dispute / litige            → UQ (Under Query)
    //   (default)                   → AP (In Process)

    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: ['peppol: invalid ref for sendStatus'] };
    }
    const [companyId, originalMessageId] = parts;

    if (!this.credentials) {
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: ['peppol: no credentials port for sendStatus'] };
    }

    const resolved = await this.credentials.resolveActive(companyId, 'peppol');
    if (!resolved?.isActive) {
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: ['peppol: credentials no longer active'] };
    }

    const { config } = resolved;
    const senderParticipantId = config.participantId as string;
    const accessPointUrl = config.accessPointUrl as string;
    const apiKey = config.apiKey as string;
    const environment = (config.environment as string ?? 'TEST') as 'TEST' | 'PROD';

    if (!senderParticipantId || !accessPointUrl || !apiKey) {
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: ['peppol: incomplete config for sendStatus'] };
    }

    const receiverPeppolId = ctx.buyer.peppolId ?? ctx.supplier.peppolId;
    if (!receiverPeppolId) {
      log.todo('transmission/peppol', `sendStatus: no peppolId on counterpart (ref ${ref})`);
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: ['peppol: no counterpart peppolId for Invoice Response'] };
    }

    const sl = status.toLowerCase();
    const responseCode: 'AB' | 'RE' | 'UQ' | 'AP' =
      ['accept', 'approv', 'cleared', 'consegn'].some((w) => sl.includes(w)) ? 'AB' :
      ['refus', 'reject', 'rechaz', 'scart'].some((w) => sl.includes(w)) ? 'RE' :
      ['litige', 'disput', 'query'].some((w) => sl.includes(w)) ? 'UQ' :
      'AP';

    try {
      const { PeppolApHttpClient } = await import('./peppol/peppol-client.js');
      const ap = this.apPort ?? new PeppolApHttpClient({ accessPointUrl, apiKey, environment });

      log.info('transmission/peppol', `sendStatus: sending Invoice Response "${responseCode}" for originalMessageId ${originalMessageId}`);
      const result = await ap.sendInvoiceResponse({
        senderParticipantId,
        receiverParticipantId: receiverPeppolId,
        originalMessageId,
        responseCode,
        description: `Invoice Response for status: ${status}`,
        idempotencyKey: `${ref}:${status}`,
      });

      return {
        channel: 'PEPPOL',
        status: 'SENT',
        ref,
        notes: [`Invoice Response sent (${responseCode}); responseMessageId: ${result.messageId}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/peppol', `sendStatus failed: ${msg}`);
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: [`peppol: sendStatus error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // Parse ref: companyId|messageId
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: 'PEPPOL', status: 'PENDING', ref, notes: ['peppol: invalid ref format'] };
    }
    const [companyId, messageId] = parts;

    if (!this.credentials) {
      return { channel: 'PEPPOL', status: 'PENDING', ref, notes: ['peppol: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'peppol');
      if (!resolved || !resolved.isActive) {
        return { channel: 'PEPPOL', status: 'PENDING', ref, notes: ['peppol: credentials no longer active'] };
      }

      const { config } = resolved;
      const accessPointUrl = config.accessPointUrl as string;
      const apiKey = config.apiKey as string;
      const environment = (config.environment as string ?? 'TEST') as 'TEST' | 'PROD';

      const { PeppolApHttpClient } = await import('./peppol/peppol-client.js');
      const ap = this.apPort ?? new PeppolApHttpClient({ accessPointUrl, apiKey, environment });

      const status = await ap.getStatus(messageId);

      return this.mapDeliveryStatus(status, ref);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/peppol', `poll failed: ${msg}`);
      return { channel: 'PEPPOL', status: 'PENDING', ref, notes: [`peppol: poll error: ${msg}`] };
    }
  }

  private mapDeliveryStatus(
    status: { messageId: string; status: string; mlrCode?: string; mlrDescription?: string },
    ref: string,
  ): TransmissionResult {
    const notes: string[] = [`messageId: ${status.messageId}`];
    if (status.mlrCode) notes.push(`MLR: ${status.mlrCode}`);
    if (status.mlrDescription) notes.push(`MLR desc: ${status.mlrDescription}`);

    switch (status.status) {
      case 'DELIVERED':
        // AS4 receipt received from receiver's AP
        return { channel: 'PEPPOL', status: 'CLEARED', ref, notes };

      case 'FAILED':
        return { channel: 'PEPPOL', status: 'REJECTED', ref, notes };

      case 'SENT':
      case 'QUEUED':
      case 'UNKNOWN':
      default:
        return { channel: 'PEPPOL', status: 'PENDING', ref, notes };
    }
  }
}
