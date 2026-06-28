import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { InvoiceMailPort } from './invoice-mail-port';
import { ChannelConfigSchema, TransmissionProvider } from './transmission-provider';

/** Email — real send via InvoiceMailPort when wired, stub otherwise. */
export class EmailTransmissionProvider implements TransmissionProvider {
  readonly id = 'email';
  readonly channel: ChannelType = 'EMAIL';
  readonly feedback = 'NONE' as const;
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'text', name: 'fromAddress', label: 'From address', placeholder: 'invoices@company.com', required: true },
      { type: 'text', name: 'replyTo', label: 'Reply-to address', placeholder: 'accounting@company.com' },
    ],
  };

  constructor(private readonly mail?: InvoiceMailPort) {}

  async transmit(artifacts: SignedArtifact[], ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    if (this.mail && ctx.externalRef) {
      const r = await this.mail.sendInvoiceEmail(ctx.externalRef);
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

export class PeppolTransmissionProvider implements TransmissionProvider {
  readonly id = 'peppol';
  readonly channel: ChannelType = 'PEPPOL';
  readonly feedback = 'ASYNC_CALLBACK' as const; // Peppol Invoice Response / MLR
  async transmit(_artifacts: SignedArtifact[], ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    log.todo('transmission/peppol', `SMP lookup for ${ctx.buyer.peppolId ?? '(no peppolId)'} + AS4 send (key ${key})`);
    return { channel: 'PEPPOL', status: ctx.buyer.peppolId ? 'SENT' : 'SKIPPED', notes: ['stub: integrate a Peppol Access Point'] };
  }
  sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/peppol', `push lifecycle status "${status}" to Peppol for ${ref}`);
    return { channel: 'PEPPOL', status: 'QUEUED', ref, notes: [`stub: relay "${status}" via Peppol Invoice Response`] };
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
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Production', value: 'prod' },
      ], default: 'sandbox' },
      { type: 'select', name: 'apiStyle', label: 'API style', required: false, options: [
        { label: 'SuperPDP (proprietary)', value: 'superpdp' },
        { label: 'AFNOR Flow (XP Z12-013)', value: 'afnor' },
      ], default: 'superpdp' },
      { type: 'text', name: 'sellerEndpointId', label: 'Seller endpoint ID', placeholder: '315143296_1422', required: false },
      { type: 'text', name: 'buyerEndpointId', label: 'Buyer endpoint ID', placeholder: '315143296_1421', required: false },
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

    // Find the Factur-X artifact (PDF/A-3 hybrid — the FR format)
    const facturxArtifact = artifacts.find((a) => a.syntax === 'FACTURX');
    if (!facturxArtifact) {
      return { channel: 'PDP', status: 'SKIPPED', notes: ['pdp: no FACTURX artifact'] };
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
      // @fin.cx/einvoice does NOT emit this element, but CTC FR rules require it.
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

  sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/pdp', `push lifecycle status "${status}" to the PDP for ${ref}`);
    return { channel: 'PDP', status: 'QUEUED', ref, notes: [`stub: relay "${status}" via registered PDP`] };
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

/** Italy — Sistema di Interscambio. */
export class SdiTransmissionProvider implements TransmissionProvider {
  readonly id = 'sdi';
  readonly channel: ChannelType = 'SDI';
  readonly feedback = 'ASYNC_CALLBACK' as const; // SdI notifiche (consegnata/scartata…)
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
  async transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    log.todo('transmission/sdi', `submit FatturaPA to SdI, await receipt/notifica (key ${key})`);
    return { channel: 'SDI', status: 'PENDING', notes: ['stub: integrate SdI'] };
  }
  sendStatus(ref: string, status: string, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `push lifecycle status "${status}" to SdI for ${ref}`);
    return { channel: 'SDI', status: 'QUEUED', ref, notes: [`stub: relay "${status}" via SdI`] };
  }
  poll(ref: string, log: ComplianceLogger): TransmissionResult {
    log.todo('transmission/sdi', `poll SdI notifiche for ${ref}`);
    return { channel: 'SDI', status: 'PENDING', ref, notes: [] };
  }
}

/** Generic government portal/API. Use a dedicated provider (below) when the system has specifics. */
export class GovPortalTransmissionProvider implements TransmissionProvider {
  readonly id = 'gov-portal';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  async transmit(_artifacts: SignedArtifact[], _ctx: TransactionContext, _plan: CompliancePlan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
    log.todo('transmission/gov-portal', `submit to government clearance/reporting API (key ${key})`);
    return { channel: 'GOV_PORTAL_API', status: 'PENDING', notes: ['stub: integrate the national portal'] };
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
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ], default: 'test' },
      { type: 'text', name: 'authToken', label: 'KSeF token', secret: true },
      { type: 'text', name: 'nip', label: 'NIP (tax id)', placeholder: 'PL1234567890' },
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
      const keys = loadVendorizedKeys(environment as 'test' | 'prod');

      const http = new FetchKsefHttpClient();
      const client = new KsefClient(http, {
        environment: environment as 'test' | 'prod',
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
      const nip = config.nip as string;
      const ksefToken = config.authToken as string;

      const { KsefClient } = await import('./ksef/ksef-client.js');
      const { FetchKsefHttpClient } = await import('./ksef/fetch-http-client.js');
      const { loadVendorizedKeys } = await import('./ksef/ksef-public-keys.js');

      const keys = loadVendorizedKeys(environment as 'test' | 'prod');
      const http = new FetchKsefHttpClient();
      const client = new KsefClient(http, {
        environment: environment as 'test' | 'prod',
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
