import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { InvoiceMailPort, SmtpOverrides } from './invoice-mail-port';
import { ChannelConfigSchema, TransmissionProvider } from './transmission-provider';
import type { SdiHttpPort } from './sdi/sdi-client';
import type { PeppolApPort } from './peppol/peppol-client';
import type { SmpLookupPort } from './peppol/smp-client';

// ---------------------------------------------------------------------------
// Helpers — status mapping
// ---------------------------------------------------------------------------

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

/** Email — real send via InvoiceMailPort when wired, stub otherwise. */
export class EmailTransmissionProvider implements TransmissionProvider {
  readonly id = 'email';
  readonly channel: ChannelType = 'EMAIL';
  readonly feedback = 'NONE' as const;
  /**
   * Per-company SMTP is optional: when no active config is found, fall back to the global
   * MAIL_PROVIDER (SMTP_* env). The registry must NOT skip this channel for missing config.
   */
  readonly optionalConfig = true;
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'text', name: 'host', label: 'SMTP host', placeholder: 'smtp.example.com', required: true },
      { type: 'number', name: 'port', label: 'SMTP port', placeholder: '587', required: true, default: 587 },
      { type: 'switch', name: 'secure', label: 'Use TLS (implicit, port 465)', default: false },
      { type: 'text', name: 'username', label: 'SMTP username', placeholder: 'apikey / user@example.com', required: true },
      { type: 'text', name: 'password', label: 'SMTP password', required: true, secret: true },
      { type: 'text', name: 'fromAddress', label: 'From address', placeholder: 'invoices@company.com', required: true },
    ],
  };

  constructor(private readonly mail?: InvoiceMailPort) {}

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    // Build per-company SMTP overrides when a config is present and complete.
    let smtpOverrides: SmtpOverrides | undefined;
    if (resolvedConfig?.config?.host && resolvedConfig.config.username && resolvedConfig.config.password) {
      const c = resolvedConfig.config;
      smtpOverrides = {
        host: c.host as string,
        port: typeof c.port === 'number' ? c.port : parseInt(String(c.port ?? '587'), 10),
        secure: Boolean(c.secure),
        username: c.username as string,
        password: c.password as string,
        fromAddress: (c.fromAddress as string) ?? (c.username as string),
      };
      log.info('transmission/email', `using per-company SMTP (host: ${smtpOverrides.host}) (key ${key})`);
    }

    if (this.mail && ctx.externalRef) {
      const r = await this.mail.sendInvoiceEmail(ctx.externalRef, smtpOverrides);
      return {
        channel: 'EMAIL',
        status: r.skipped ? 'SKIPPED' : 'SENT',
        notes: r.skipped ? [r.reason ?? 'no email'] : [],
      };
    }
    log.todo('transmission/email', `send ${artifacts.length} artifact(s) to ${ctx.buyer.legalName} via MailService (key ${key})`);
    return { channel: 'EMAIL', status: 'SENT', notes: ['stub: wire to MailService.sendMail'] };
  }
}

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

    // Determine receiver participant ID from ctx
    const receiverPeppolId = ctx.buyer.peppolId;
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

/** France — Plateforme de Dématérialisation Partenaire (+ PPF annuaire routing). */
export class PdpTransmissionProvider implements TransmissionProvider {
  readonly id = 'pdp';
  readonly channel: ChannelType = 'PDP';
  readonly feedback = 'ASYNC_CALLBACK' as const; // PDP pushes lifecycle statuses (déposée/refusée/encaissée); poll() is the fallback
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'text', name: 'baseUrl', label: 'API base URL', placeholder: 'https://api.superpdp.tech', required: true },
      { type: 'text', name: 'clientId', label: 'Client ID', required: true },
      { type: 'text', name: 'clientSecret', label: 'Client secret', required: true, secret: true },
      { type: 'select', name: 'environment', label: 'Environment', required: true, options: [
        { label: 'Test (sandbox)', value: 'TEST' },
        { label: 'Production', value: 'PROD' },
      ], default: 'TEST' },
      { type: 'select', name: 'apiStyle', label: 'API style', required: false, options: [
        { label: 'SuperPDP (proprietary)', value: 'superpdp' },
        { label: 'AFNOR Flow (XP Z12-013)', value: 'afnor' },
      ], default: 'superpdp' },
      // The company's OWN routing address on its PDP: {pdp_siren}_{account_id}. The buyer's
      // endpoint is resolved per-invoice from the client/annuaire — not configured here.
      { type: 'text', name: 'sellerEndpointId', label: 'Your PDP routing ID', placeholder: '315143296_1422', required: false },
    ],
  };

  constructor(private readonly credentials?: ChannelCredentialsPort) {}

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
      return { channel: 'PDP', status: 'SKIPPED', notes: ['pdp: incomplete config (baseUrl, clientId, clientSecret required)'] };
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

      let rawBytes = typeof facturxArtifact.bytes === 'string'
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
        const buyerRouting = config.buyerEndpointId as string | undefined;
        const patched = postProcessCiiForCtc(originalXml, { sellerRouting, buyerRouting });
        if (patched !== originalXml) {
          log.info('transmission/pdp', `CTC post-processing: injected SpecifiedLegalOrganization (key ${key})`);
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
          processingRule: 'B2B',
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

  async sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<TransmissionResult> {
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
        log.todo('transmission/pdp', `sendStatus AFNOR: flow "${invoiceIdOrFlowId}" status "${status}" (code ${pdpCode}) — no standard endpoint yet`);
        return { channel: 'PDP', status: 'QUEUED', ref, notes: [`pdp: AFNOR sendStatus deferred (no v1 endpoint); would push ${pdpCode}`] };
      }

      // SuperPDP: POST /v1.beta/invoices/{id}/lifecycle_events { code }
      const invoiceId = parseInt(invoiceIdOrFlowId, 10);
      if (Number.isNaN(invoiceId)) {
        return { channel: 'PDP', status: 'QUEUED', ref, notes: [`pdp: invalid invoiceId in ref: ${invoiceIdOrFlowId}`] };
      }

      log.info('transmission/pdp', `sendStatus: pushing "${pdpCode}" for invoiceId ${invoiceId} (ref ${ref})`);
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
    client: { getFlow(flowId: string): Promise<{ flowId: string; acknowledgement?: { status: string; details?: Array<{ reasonCode: string; reasonMessage: string }> } }> },
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
      const details = flow.acknowledgement?.details?.map((d) => `${d.reasonCode}: ${d.reasonMessage}`).join('; ') ?? '';
      return { channel: 'PDP', status: 'REJECTED', ref, notes: [`pdp: flow rejected${details ? ` — ${details}` : ''}`] };
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

/** Mexico — Proveedor Autorizado de Certificación (blocking clearance → returns folio/UUID). */
export class PacTransmissionProvider implements TransmissionProvider {
  readonly id = 'pac';
  readonly channel: ChannelType = 'PAC';
  readonly feedback = 'ASYNC_POLL' as const; // poll PAC for SAT clearance result
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  async transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    log.todo('transmission/pac', `submit to PAC for SAT clearance, await UUID/folio fiscal (key ${key})`);
    return { channel: 'PAC', status: 'PENDING', notes: ['stub: integrate a PAC; clearance is asynchronous'] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pac', `poll PAC clearance result for ${ref}`);
    return { channel: 'PAC', status: 'PENDING', ref, notes: [] };
  }
}

/**
 * Italy — Sistema di Interscambio.
 *
 * LIVE PROOF: DEFERRED — requires AdE (Agenzia delle Entrate) intermediary accreditation
 * and a qualified digital certificate (PFX) before a real round-trip can be attempted.
 * All unit tests use a mocked SdiHttpPort.
 *
 * Transmission flow:
 *   1. transmit(): build a SdiClient from the resolved config, submit FatturaPA → PENDING + ref.
 *   2. poll(): re-check SdI for the latest notifica → map to CLEARED/REJECTED/PENDING.
 *   3. Inbound callbacks (notifiche): handled via the InboundRouter (not implemented here).
 *
 * Ref format: "{companyId}|{idSdI}|{idTrasmittente}"
 */
export class SdiTransmissionProvider implements TransmissionProvider {
  readonly id = 'sdi';
  readonly channel: ChannelType = 'SDI';
  readonly feedback = 'ASYNC_CALLBACK' as const; // SdI notifiche (consegnata/scartata…)
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 72, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'text', name: 'idTrasmittente', label: 'IdTrasmittente', placeholder: 'IT01234567890', required: true },
      { type: 'select', name: 'transmitChannel', label: 'Transmission channel', required: true, options: [
        { label: 'SDI Cooperativa (web service)', value: 'SDICoop' },
        { label: 'PEC (Posta Elettronica Certificata)', value: 'PEC' },
      ]},
      { type: 'text', name: 'certificate', label: 'PFX certificate (base64)', required: true, secret: true },
      { type: 'text', name: 'certificatePassword', label: 'Certificate password', required: true, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Inject a mock SdiHttpPort for tests; production uses the default stub. */
    private readonly httpPort?: SdiHttpPort,
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
      log.info('transmission/sdi', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const idTrasmittente = config.idTrasmittente as string;
    const certificate = config.certificate as string | undefined;
    const certificatePassword = config.certificatePassword as string | undefined;

    if (!idTrasmittente) {
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: incomplete config (idTrasmittente required)'] };
    }

    // Find FatturaPA artifact
    const fatturapaArtifact = artifacts.find((a) => a.syntax === 'FATTURAPA');
    if (!fatturapaArtifact) {
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: no FATTURAPA artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: no supplierCompanyId in context'] };
    }

    try {
      const { SdiClient } = await import('./sdi/sdi-client.js');

      const xmlBytes = typeof fatturapaArtifact.bytes === 'string'
        ? Buffer.from(fatturapaArtifact.bytes, 'utf-8')
        : fatturapaArtifact.bytes instanceof Buffer
          ? fatturapaArtifact.bytes
          : Buffer.from(fatturapaArtifact.bytes);

      // Derive canonical SdI filename: IT{idTrasmittente}_{progr}.xml (simplified from key)
      const filename = `${idTrasmittente}_${key.slice(-5).replace(/[^a-zA-Z0-9]/g, '0')}.xml`;

      // Use injected HTTP port (test mock) or fall back to a stub that throws clearly.
      // A real SDICoop SOAP client requires AdE intermediary accreditation + PFX certificate.
      const http = this.httpPort ?? {
        submit: async () => { throw new Error('SdI SDICoop transport not implemented — AdE intermediary accreditation and PFX certificate required'); },
        getStatus: async () => { throw new Error('SdI SDICoop transport not implemented — AdE intermediary accreditation required'); },
        sendEsito: async () => { throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required'); },
      };

      const client = new SdiClient(http, { idTrasmittente, certificate, certificatePassword });

      log.info('transmission/sdi', `submitting FatturaPA to SdI (key ${key}, file ${filename})`);
      const result = await client.submit(xmlBytes, filename);

      const ref = `${companyId}|${result.idSdI}|${idTrasmittente}`;
      log.info('transmission/sdi', `submitted → idSdI ${result.idSdI} (key ${key})`);
      return { channel: 'SDI', status: 'PENDING', ref, notes: [`idSdI: ${result.idSdI}`, `file: ${result.filename}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sdi', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'SDI', status: 'REJECTED', notes: [`sdi: transmit error: ${msg}`] };
    }
  }

  async sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<TransmissionResult> {
    // Emit the esito committente (NE notifica) — buyer acceptance/refusal — to SdI.
    // Called when WE are the buyer receiving a FatturaPA and emitting our response.
    //
    // Status mapping:
    //   accept / approv / consegn → EC01 (accettazione — accepted)
    //   refus / reject / scart   → EC02 (rifiuto — refused)
    //
    // Ref format: "companyId|idSdI|idTrasmittente"
    //
    // LIVE PROOF: DEFERRED — SDICoop SOAP transport requires AdE intermediary accreditation
    // and a qualified PFX certificate. The SdiHttpPort.sendEsito() port is defined;
    // inject a real SOAP transport once accreditation is obtained.

    const parts = ref.split('|');
    if (parts.length !== 3) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: invalid ref for sendStatus'] };
    }
    const [companyId, idSdIStr, idTrasmittente] = parts;
    const idSdI = parseInt(idSdIStr, 10);

    if (Number.isNaN(idSdI)) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: invalid idSdI in ref'] };
    }

    const sl = status.toLowerCase();
    const esito: 'EC01' | 'EC02' =
      ['accept', 'approv', 'consegn', 'cleared', 'autoriz'].some((w) => sl.includes(w)) ? 'EC01' : 'EC02';

    if (!this.credentials) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: no credentials port for sendStatus'] };
    }

    const resolved = await this.credentials.resolveActive(companyId, 'sdi');
    if (!resolved?.isActive) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: credentials no longer active'] };
    }

    const { config } = resolved;
    const certificate = config.certificate as string | undefined;
    const certificatePassword = config.certificatePassword as string | undefined;

    try {
      const { SdiClient } = await import('./sdi/sdi-client.js');

      // Use injected port (test mock) or fall back to a stub that throws clearly.
      // A real SOAP SDICoop client with sendEsito() requires AdE accreditation.
      const http = this.httpPort ?? {
        submit: async () => { throw new Error('SdI SDICoop transport not implemented'); },
        getStatus: async () => { throw new Error('SdI SDICoop transport not implemented'); },
        sendEsito: async () => { throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required'); },
      };

      const client = new SdiClient(http, { idTrasmittente, certificate, certificatePassword });

      log.info('transmission/sdi', `sendStatus: sending esito ${esito} (${status}) for idSdI ${idSdI} (ref ${ref})`);
      await client.sendEsito(idSdI, esito);
      return {
        channel: 'SDI',
        status: 'SENT',
        ref,
        notes: [`esito committente ${esito} sent for idSdI ${idSdI}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sdi', `sendStatus failed: ${msg} (ref ${ref})`);
      return { channel: 'SDI', status: 'QUEUED', ref, notes: [`sdi: sendStatus error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // Parse ref: companyId|idSdI|idTrasmittente
    const parts = ref.split('|');
    if (parts.length !== 3) {
      return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: invalid ref format'] };
    }
    const [companyId, idSdIStr, idTrasmittente] = parts;
    const idSdI = parseInt(idSdIStr, 10);

    if (Number.isNaN(idSdI)) {
      return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: invalid idSdI in ref'] };
    }

    if (!this.credentials) {
      return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'sdi');
      if (!resolved || !resolved.isActive) {
        return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: credentials no longer active'] };
      }

      const { config } = resolved;
      const certificate = config.certificate as string | undefined;
      const certificatePassword = config.certificatePassword as string | undefined;

      const { SdiClient } = await import('./sdi/sdi-client.js');

      const http = this.httpPort ?? {
        submit: async () => { throw new Error('SdI transport not implemented'); },
        getStatus: async () => { throw new Error('SdI SDICoop transport not implemented — AdE accreditation required'); },
        sendEsito: async () => { throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required'); },
      };

      const client = new SdiClient(http, { idTrasmittente, certificate, certificatePassword });

      const status = await client.getStatus(idSdI);

      if (!status.latestNotifica) {
        return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: no notifica received yet'] };
      }

      return SdiClient.mapNotifica(status.latestNotifica, ref);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sdi', `poll failed: ${msg}`);
      return { channel: 'SDI', status: 'PENDING', ref, notes: [`sdi: poll error: ${msg}`] };
    }
  }
}

/** Poland — Krajowy System e-Faktur. A GOV_PORTAL_API system selected via ChannelSpec.providerId='ksef'. */
export class KsefTransmissionProvider implements TransmissionProvider {
  readonly id = 'ksef';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const; // poll KSeF for the UPO / reference number
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'select', name: 'environment', label: 'KSeF environment', required: true, options: [
        { label: 'Test', value: 'TEST' },
        { label: 'Production', value: 'PROD' },
      ], default: 'TEST' },
      { type: 'text', name: 'authToken', label: 'KSeF token', required: true, secret: true },
      // NIP is NOT asked here — it's a required company identifier, auto-filled at save time.
    ],
  };

  constructor(private readonly credentials?: ChannelCredentialsPort) {}

  async transmit(
    _artifacts: SignedArtifact[],
    _ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) {
      log.info('transmission/ksef', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['ksef: no resolved config'] };
    }

    const { config, environment } = resolvedConfig;
    // DB stores ChannelEnvironment as TEST/PROD; the KSeF client expects lowercase test/prod.
    const env = (environment ?? 'test').toLowerCase() as 'test' | 'prod';
    const nip = config.nip as string;
    const ksefToken = config.authToken as string;

    if (!nip || !ksefToken) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['ksef: incomplete config (nip and authToken required)'] };
    }

    // Find the FA_VAT artifact
    const faVatArtifact = _artifacts.find((a) => a.syntax === 'FA_VAT');
    if (!faVatArtifact) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['ksef: no FA_VAT artifact'] };
    }

    const companyId = _ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['ksef: no supplierCompanyId in context'] };
    }

    try {
      const { KsefClient } = await import('./ksef/ksef-client.js');
      const { FetchKsefHttpClient } = await import('./ksef/fetch-http-client.js');
      const { generateSessionKey } = await import('./ksef/ksef-crypto.js');
      const { loadVendorizedKeys } = await import('./ksef/ksef-public-keys.js');

      // Load MF public keys from vendorized PEM files (no company input needed)
      const keys = loadVendorizedKeys(env);

      const http = new FetchKsefHttpClient();
      const client = new KsefClient(http, {
        environment: env,
        nip,
        ksefToken,
        tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
        symmetricKeyPem: keys.symmetricKeyPem,
      });

      const xmlContent = typeof faVatArtifact.bytes === 'string'
        ? faVatArtifact.bytes
        : new TextDecoder('utf-8').decode(faVatArtifact.bytes);

      // 1. Auth: challenge → ksef-token → poll status → redeem
      log.info('transmission/ksef', `auth challenge (key ${key})`);
      const challenge = await client.authChallenge();

      log.info('transmission/ksef', `auth ksef-token (key ${key})`);
      const authResponse = await client.authKsefToken(challenge.challenge, challenge.timestampMs);

      // Poll auth status (max 5 attempts, 2s interval)
      let authSuccess = false;
      for (let i = 0; i < 5; i++) {
        const authStatus = await client.authStatus(authResponse.referenceNumber, authResponse.authenticationToken.token);
        if (authStatus.status.code === 200) {
          authSuccess = true;
          break;
        }
        if (authStatus.status.code >= 400) {
          return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`ksef: auth failed (code ${authStatus.status.code}: ${authStatus.status.description})`] };
        }
        // Still processing (100) — wait and retry
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!authSuccess) {
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', notes: ['ksef: auth still processing after retries'] };
      }

      log.info('transmission/ksef', `auth token redeem (key ${key})`);
      const tokens = await client.authRedeem(authResponse.authenticationToken.token);

      // 2. Open online session
      log.info('transmission/ksef', `open online session (key ${key})`);
      const sessionKey = generateSessionKey();
      const session = await client.openOnlineSession(tokens.accessToken.token, sessionKey);

      // 3. Send encrypted invoice
      log.info('transmission/ksef', `send invoice (key ${key})`);
      const invoiceResult = await client.sendInvoice(
        session.referenceNumber,
        tokens.accessToken.token,
        xmlContent,
        sessionKey,
      );

      // 4. Close session (triggers UPO generation)
      log.info('transmission/ksef', `close session (key ${key})`);
      await client.closeSession(session.referenceNumber, tokens.accessToken.token);

      // Build ref: companyId|sessionRef|invoiceRef
      const ref = `${companyId}|${session.referenceNumber}|${invoiceResult.referenceNumber}`;
      log.info('transmission/ksef', `submitted → session ${session.referenceNumber}, invoice ${invoiceResult.referenceNumber} (key ${key})`);

      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/ksef', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'GOV_PORTAL_API', status: 'REJECTED', notes: [`ksef: transmit error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // Parse ref: companyId|sessionRef|invoiceRef
    const parts = ref.split('|');
    if (parts.length !== 3) {
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['ksef: invalid ref format'] };
    }
    const [companyId, sessionRef, invoiceRef] = parts;

    if (!this.credentials) {
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['ksef: no credentials port'] };
    }

    try {
      // Re-resolve credentials from persisted config (survives restarts)
      const resolved = await this.credentials.resolveActive(companyId, 'ksef');
      if (!resolved || !resolved.isActive) {
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['ksef: credentials no longer active'] };
      }

      const { config, environment } = resolved;
      // DB stores ChannelEnvironment as TEST/PROD; the KSeF client expects lowercase test/prod.
      const env = (environment ?? 'test').toLowerCase() as 'test' | 'prod';
      const nip = config.nip as string;
      const ksefToken = config.authToken as string;

      const { KsefClient } = await import('./ksef/ksef-client.js');
      const { FetchKsefHttpClient } = await import('./ksef/fetch-http-client.js');
      const { loadVendorizedKeys } = await import('./ksef/ksef-public-keys.js');

      const keys = loadVendorizedKeys(env);
      const http = new FetchKsefHttpClient();
      const client = new KsefClient(http, {
        environment: env,
        nip,
        ksefToken,
        tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
        symmetricKeyPem: keys.symmetricKeyPem,
      });

      // Re-authenticate (challenge → ksef-token → poll → redeem)
      const challenge = await client.authChallenge();
      const authResponse = await client.authKsefToken(challenge.challenge, challenge.timestampMs);

      let authSuccess = false;
      for (let i = 0; i < 5; i++) {
        const authStatus = await client.authStatus(authResponse.referenceNumber, authResponse.authenticationToken.token);
        if (authStatus.status.code === 200) { authSuccess = true; break; }
        if (authStatus.status.code >= 400) {
          return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`ksef: poll auth failed (code ${authStatus.status.code})`] };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!authSuccess) {
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: ['ksef: poll auth still processing'] };
      }

      const tokens = await client.authRedeem(authResponse.authenticationToken.token);

      // Check invoice status
      const status = await client.invoiceStatus(sessionRef, invoiceRef, tokens.accessToken.token);

      // Map KSeF status codes to lifecycle outcomes
      const code = status.status.code;
      if (code === 200) {
        // Success → CLEARED (ksefNumber assigned)
        const notes: string[] = [];
        if (status.ksefNumber) notes.push(`ksefNumber: ${status.ksefNumber}`);
        if (status.invoiceNumber) notes.push(`invoiceNumber: ${status.invoiceNumber}`);
        return { channel: 'GOV_PORTAL_API', status: 'CLEARED', ref, notes };
      }
      if (code === 100 || code === 150) {
        // 100 = accepted for processing, 150 = still processing → PENDING
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [] };
      }
      if (code >= 400) {
        // Rejected / semantic error
        return { channel: 'GOV_PORTAL_API', status: 'REJECTED', ref, notes: [`ksef: code ${code}: ${status.status.description}`] };
      }

      // Default: pending
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`ksef: status code ${code}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/ksef', `poll failed: ${msg}`);
      return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [`ksef: poll error: ${msg}`] };
    }
  }
}

/** Peru / generic — Operador de Servicios Electrónicos. */
export class OseTransmissionProvider implements TransmissionProvider {
  readonly id = 'ose';
  readonly channel: ChannelType = 'OSE';
  readonly feedback = 'ASYNC_POLL' as const; // await the CDR
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  async transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    log.todo('transmission/ose', `submit to OSE, await CDR (key ${key})`);
    return { channel: 'OSE', status: 'PENDING', notes: ['stub: integrate an OSE'] };
  }
}

/** Physical print (B2C mandates: CL, many LATAM, SA simplified). */
export class PrintTransmissionProvider implements TransmissionProvider {
  readonly id = 'print';
  readonly channel: ChannelType = 'PRINT';
  readonly feedback = 'NONE' as const;
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'switch', name: 'includeQR', label: 'Include QR code', default: true },
      { type: 'switch', name: 'includePaymentInfo', label: 'Include payment information', default: false },
    ],
  };
  async transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    log.todo('transmission/print', `produce printable representation with QR (key ${key})`);
    return { channel: 'PRINT', status: 'SENT', notes: ['stub: generate printable PDF/receipt'] };
  }
}
