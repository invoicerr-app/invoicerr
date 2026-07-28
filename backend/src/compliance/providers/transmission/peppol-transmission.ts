import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';
import type { PeppolApPort } from './peppol/peppol-client';
import type { SmpLookupPort } from './peppol/smp-client';
import type { BuyerDirectoryPort } from './buyer-directory-port';

/**
 * Peppol 4-corner transmission provider — multi-vendor Access Point support.
 *
 * One port (PeppolApPort), several adapters, per-company choice: the `apProvider`
 * config field selects the corner-2 vendor (see peppol/ap-adapters.ts):
 *   - 'generic'   (default) — REST gateway model (accessPointUrl + apiKey); SMP pre-check here.
 *   - 'peppol-sh' — hosted AP, free sandbox, zero-secret self-signup; vendor resolves routing.
 *   - 'storecove' — hosted AP, raw-UBL submission; vendor resolves routing.
 *
 * LIVE PROOF: PROVEN via peppol.sh sandbox (2026-07-11) — real round-trip
 * transmit → doc_… id → poll → CLEARED (peppol-sh-live.spec.ts, zero secrets:
 * the spec self-signs-up). Generic gateway + Storecove remain live-deferred
 * (need a connected AP / trial credentials). Invoice Response push is live-deferred.
 *
 * Transmission flow:
 *   1. SMP/SML lookup (generic only): DNS → SMP → receiver's AP endpoint URL.
 *   2. AP send via the resolved adapter (wraps AS4/ebMS3 at the vendor).
 *   3. poll(): adapter status → map delivery/MLR to lifecycle.
 *
 * Ref format: "{companyId}|{messageId}"
 */
export class PeppolTransmissionProvider implements TransmissionProvider {
  readonly id = 'peppol';
  readonly channel: ChannelType = 'PEPPOL';
  /** PROVEN via peppol.sh sandbox (2026-07-11) — real round-trip transmit → poll → CLEARED. */
  readonly maturity: ProviderMaturity = 'PROVEN';
  readonly feedback = 'ASYNC_CALLBACK' as const; // Peppol Invoice Response / MLR
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
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
      // Which Access-Point vendor fulfils the PeppolApPort (mirrors PDP's apiStyle switch).
      // Absent/empty → 'generic' so pre-existing configs keep working unchanged.
      {
        type: 'select',
        name: 'apProvider',
        label: 'Access Point provider',
        required: false,
        options: [
          { label: 'Generic AP gateway (REST)', value: 'generic' },
          { label: 'peppol.sh (hosted, free sandbox)', value: 'peppol-sh' },
          { label: 'Storecove (hosted)', value: 'storecove' },
        ],
        default: 'generic',
      },
      {
        type: 'text',
        name: 'participantId',
        label: 'Your Peppol ID',
        placeholder: '0009:12345678900011',
        required: true,
      },
      // Required for 'generic'; optional base-URL override for hosted vendors.
      {
        type: 'text',
        name: 'accessPointUrl',
        label: 'Access Point gateway URL (generic; optional override for hosted)',
        placeholder: 'https://ap.example.com',
        required: false,
      },
      { type: 'text', name: 'apiKey', label: 'Access Point API key', required: true, secret: true },
      // peppol.sh only: the com_… company id documents are sent through.
      {
        type: 'text',
        name: 'apCompanyId',
        label: 'peppol.sh company ID',
        placeholder: 'com_…',
        required: false,
      },
      // Storecove only: the LegalEntity id documents are sent on behalf of.
      {
        type: 'text',
        name: 'legalEntityId',
        label: 'Storecove legal entity ID',
        required: false,
      },
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
    const senderParticipantId = (config.participantId as string) ?? '';
    const environment = ((config.environment as string) ?? 'TEST') as 'TEST' | 'PROD';

    // Multi-vendor AP support: the per-company config selects the corner-2 adapter.
    const { apProviderOf, apProviderHandlesRouting, missingPeppolConfig, resolvePeppolAdapter } =
      await import('./peppol/ap-adapters.js');
    const apProvider = apProviderOf(config);
    const missing = missingPeppolConfig(config);
    if (missing.length > 0) {
      return {
        channel: 'PEPPOL',
        status: 'SKIPPED',
        notes: [`peppol: incomplete config for apProvider '${apProvider}' (${missing.join(', ')} required)`],
      };
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
            log.info(
              'transmission/peppol',
              `directory resolved buyer ${peppolIdentifier.value} → ${receiverPeppolId} (key ${key})`,
            );
          }
        } catch {
          // Directory unavailable — proceed without peppolId (non-blocking).
        }
      }
    }

    // peppol.sh can route from the tax id embedded in the document; every other vendor
    // needs an explicit receiver participant id.
    if (!receiverPeppolId && apProvider !== 'peppol-sh') {
      return {
        channel: 'PEPPOL',
        status: 'SKIPPED',
        notes: ['peppol: buyer has no peppolId — cannot route'],
      };
    }

    // Find UBL or CII artifact (PEPPOL_BIS preferred, then EN16931_UBL, then EN16931_CII)
    const documentArtifact =
      artifacts.find((a) => a.syntax === 'PEPPOL_BIS') ??
      artifacts.find((a) => a.syntax === 'EN16931_UBL') ??
      artifacts.find((a) => a.syntax === 'EN16931_CII');

    if (!documentArtifact) {
      return {
        channel: 'PEPPOL',
        status: 'SKIPPED',
        notes: ['peppol: no PEPPOL_BIS, EN16931_UBL, or EN16931_CII artifact'],
      };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'PEPPOL', status: 'SKIPPED', notes: ['peppol: no supplierCompanyId'] };
    }

    try {
      const { PEPPOL_BILLING_PROCESS_ID, PEPPOL_DOC_TYPES } = await import('./peppol/peppol-client.js');
      const docTypeId = PEPPOL_DOC_TYPES.INVOICE_UBL;

      // SMP/SML pre-check only for the generic gateway: hosted vendors (peppol.sh,
      // Storecove) resolve the receiver themselves at corner 2.
      if (!apProviderHandlesRouting(apProvider)) {
        const { DnsSmpLookup } = await import('./peppol/smp-client.js');

        // Parse receiver participant ID: icd:identifier
        const [receiverIcd, receiverIdentifier] = (receiverPeppolId ?? '').split(':');
        if (!receiverIcd || !receiverIdentifier) {
          return {
            channel: 'PEPPOL',
            status: 'SKIPPED',
            notes: [`peppol: invalid receiverPeppolId format (expected icd:identifier): ${receiverPeppolId}`],
          };
        }

        // SMP lookup to confirm the receiver is registered and find their AP endpoint
        const smp = this.smpPort ?? new DnsSmpLookup();

        log.info('transmission/peppol', `SMP lookup for receiver ${receiverPeppolId} (key ${key})`);
        const smpResult = await smp.lookup(
          { icd: receiverIcd, identifier: receiverIdentifier },
          docTypeId,
          environment,
        );

        if (!smpResult) {
          return {
            channel: 'PEPPOL',
            status: 'SKIPPED',
            notes: [`peppol: receiver ${receiverPeppolId} not found in SMP — not registered on Peppol`],
          };
        }

        log.info('transmission/peppol', `SMP resolved → AP endpoint: ${smpResult.endpoint.url} (key ${key})`);
      } else {
        log.info(
          'transmission/peppol',
          `apProvider '${apProvider}' resolves the receiver itself — skipping local SMP pre-check (key ${key})`,
        );
      }

      const documentBytes =
        typeof documentArtifact.bytes === 'string'
          ? Buffer.from(documentArtifact.bytes, 'utf-8')
          : documentArtifact.bytes instanceof Buffer
            ? documentArtifact.bytes
            : Buffer.from(documentArtifact.bytes);

      // Submit via the configured AP adapter (injected port wins — tests/live specs)
      const ap = this.apPort ?? resolvePeppolAdapter(config);
      log.info('transmission/peppol', `submitting via AP adapter '${apProvider}' (key ${key})`);
      const sendResult = await ap.send({
        senderParticipantId,
        receiverParticipantId: receiverPeppolId ?? '',
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

  async sendStatus(
    ref: string,
    status: string,
    ctx: TransactionContext,
    _plan: CompliancePlan,
    log: ComplianceLogger,
  ): Promise<TransmissionResult> {
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
      return {
        channel: 'PEPPOL',
        status: 'QUEUED',
        ref,
        notes: ['peppol: no credentials port for sendStatus'],
      };
    }

    const resolved = await this.credentials.resolveActive(companyId, 'peppol');
    if (!resolved?.isActive) {
      return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: ['peppol: credentials no longer active'] };
    }

    const { config } = resolved;
    const senderParticipantId = (config.participantId as string) ?? '';

    const { apProviderOf, missingPeppolConfig, resolvePeppolAdapter } = await import(
      './peppol/ap-adapters.js'
    );
    const missing = missingPeppolConfig(config);
    if (missing.length > 0) {
      return {
        channel: 'PEPPOL',
        status: 'QUEUED',
        ref,
        notes: [
          `peppol: incomplete config for sendStatus (apProvider '${apProviderOf(config)}': ${missing.join(', ')} required)`,
        ],
      };
    }

    const receiverPeppolId = ctx.buyer.peppolId ?? ctx.supplier.peppolId;
    if (!receiverPeppolId) {
      log.todo('transmission/peppol', `sendStatus: no peppolId on counterpart (ref ${ref})`);
      return {
        channel: 'PEPPOL',
        status: 'QUEUED',
        ref,
        notes: ['peppol: no counterpart peppolId for Invoice Response'],
      };
    }

    const sl = status.toLowerCase();
    const responseCode: 'AB' | 'RE' | 'UQ' | 'AP' = ['accept', 'approv', 'cleared', 'consegn'].some((w) =>
      sl.includes(w),
    )
      ? 'AB'
      : ['refus', 'reject', 'rechaz', 'scart'].some((w) => sl.includes(w))
        ? 'RE'
        : ['litige', 'disput', 'query'].some((w) => sl.includes(w))
          ? 'UQ'
          : 'AP';

    try {
      const ap = this.apPort ?? resolvePeppolAdapter(config);

      log.info(
        'transmission/peppol',
        `sendStatus: sending Invoice Response "${responseCode}" for originalMessageId ${originalMessageId}`,
      );
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

      const { apProviderOf, missingPeppolConfig, resolvePeppolAdapter } = await import(
        './peppol/ap-adapters.js'
      );
      const missing = missingPeppolConfig(config);
      if (missing.length > 0) {
        return {
          channel: 'PEPPOL',
          status: 'PENDING',
          ref,
          notes: [
            `peppol: incomplete config for poll (apProvider '${apProviderOf(config)}': ${missing.join(', ')} required)`,
          ],
        };
      }

      const ap = this.apPort ?? resolvePeppolAdapter(config);

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
      default:
        return { channel: 'PEPPOL', status: 'PENDING', ref, notes };
    }
  }
}
