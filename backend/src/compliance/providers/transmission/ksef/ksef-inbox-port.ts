/**
 * KsefInboxPort — KSeF 2.0 PURCHASE-invoice reception (M-6 / F-15).
 *
 * "A Polish company cannot receive the invoices where it is the buyer via KSeF" — this port
 * closes that gap: it queries KSeF for invoices where a company is the BUYER
 * (`subjectType: 'Subject2'`), downloads the FA(2)/FA(3) XML for each, and yields them as
 * `InboxMessage`s carrying `documentBytes` — `InboxPoller.tick()` routes those to the
 * `InboundDocumentSink` (→ `InboundInvoiceService.receiveDocument()`), the SAME parse/store/dedup
 * path already used by the `receive/:channel` webhook and surfaced by the existing
 * `received-invoices` list/endpoints. No parallel reception path.
 *
 * Self-activation: `poll()` calls `ChannelCredentialsPort.listActiveByProvider('ksef')` and
 * iterates every (companyId, environment) row it returns. Zero companies configured (or the port
 * doesn't support bulk listing, or `CREDENTIALS_ENCRYPTION_KEY` is unset) ⇒ `poll()` returns []
 * on the first await — identical, offline-safe shape to `NullInboxPort`. There is no separate
 * "inbound" credential: a KSeF token minted for a NIP grants both send (`InvoiceWrite`) and query
 * (`InvoiceRead`) permissions by default, so the SAME `ksef` channel config already used for
 * transmission activates reception too.
 *
 * Auth: duplicates the 4-step challenge→ksef-token→poll→redeem sequence from
 * `ksef-transmission.ts` locally (NOT extracted into a shared helper, NOT importing from
 * ksef-transmission.ts) — per the guardrail to leave the PROVEN send/poll transmit path
 * completely untouched by this change.
 *
 * Cursor: none persisted. Each poll re-queries a rolling lookback window (default 48h) by
 * `PermanentStorage` date — KSeF's own incremental-download guidance (stable, immune to
 * async-processing reordering that `Issue`/`Invoicing` dates are subject to). The window
 * deliberately overlaps between polls; correctness relies entirely on
 * `InboundInvoiceService`'s (channel, externalId) dedup (externalId = ksefNumber, a
 * KSeF-assigned identifier that is globally unique to one invoice/one buyer, so no persisted
 * cursor is needed to stay correct — only to be maximally efficient, which is not required here:
 * the sweep tick runs hourly by default and KSeF's own metadata-query rate limit is 20 req/hour).
 */
import { InboxMessage, InboxPort } from '../../../lifecycle/drivers/inbox-port';
import { ActiveChannelConfig, ChannelCredentialsPort } from '../channel-credentials-port';
import { ComplianceLogger, defaultLogger } from '../../../execution/logger';
import { KsefClient, KsefHttpClient } from './ksef-client';
import { FetchKsefHttpClient } from './fetch-http-client';
import { loadVendorizedKeys } from './ksef-public-keys';

export interface KsefInboxPortDeps {
  credentials: ChannelCredentialsPort;
  /** Injectable for tests — defaults to a real `FetchKsefHttpClient` per company poll. */
  httpClientFactory?: () => KsefHttpClient;
  log?: ComplianceLogger;
  /** Rolling lookback window for each poll, in hours (default 48h). */
  lookbackHours?: number;
  /** Page size for the metadata query (default 100; KSeF caps at 250). */
  pageSize?: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class KsefInboxPort implements InboxPort {
  readonly id = 'ksef:query';

  private readonly credentials: ChannelCredentialsPort;
  private readonly httpClientFactory: () => KsefHttpClient;
  private readonly log: ComplianceLogger;
  private readonly lookbackHours: number;
  private readonly pageSize: number;

  constructor(deps: KsefInboxPortDeps) {
    this.credentials = deps.credentials;
    this.httpClientFactory = deps.httpClientFactory ?? (() => new FetchKsefHttpClient());
    this.log = deps.log ?? defaultLogger;
    this.lookbackHours = deps.lookbackHours ?? 48;
    this.pageSize = deps.pageSize ?? 100;
  }

  async poll(): Promise<InboxMessage[]> {
    if (!this.credentials.listActiveByProvider) return [];

    let configs: ActiveChannelConfig[];
    try {
      configs = await this.credentials.listActiveByProvider('ksef');
    } catch (err) {
      this.log.warn('ksef-inbox', `listActiveByProvider failed: ${errMsg(err)}`);
      return [];
    }
    if (configs.length === 0) return [];

    const messages: InboxMessage[] = [];
    for (const cfg of configs) {
      try {
        messages.push(...(await this.pollCompany(cfg)));
      } catch (err) {
        this.log.warn('ksef-inbox', `poll failed for company ${cfg.companyId}: ${errMsg(err)}`);
      }
    }
    return messages;
  }

  private async pollCompany(cfg: ActiveChannelConfig): Promise<InboxMessage[]> {
    const nip = cfg.config.nip as string | undefined;
    const ksefToken = cfg.config.authToken as string | undefined;
    if (!nip || !ksefToken) return [];

    const env = (cfg.environment ?? 'TEST').toLowerCase() as 'test' | 'prod';
    const keys = loadVendorizedKeys(env);
    const http = this.httpClientFactory();
    const client = new KsefClient(http, {
      environment: env,
      nip,
      ksefToken,
      tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
      symmetricKeyPem: keys.symmetricKeyPem,
    });

    const accessToken = await this.authenticate(client);
    if (!accessToken) return [];

    const now = new Date();
    const from = new Date(now.getTime() - this.lookbackHours * 3600_000);

    const metadata = await client.queryInvoicesMetadata(
      accessToken,
      {
        subjectType: 'Subject2', // Podmiot 2 = nabywca = the polled company acting as BUYER
        dateRange: { dateType: 'PermanentStorage', from: from.toISOString(), to: now.toISOString() },
      },
      { pageOffset: 0, pageSize: this.pageSize, sortOrder: 'Asc' },
    );

    const messages: InboxMessage[] = [];
    for (const inv of metadata.invoices) {
      try {
        const xml = await client.getInvoiceByKsefNumber(accessToken, inv.ksefNumber);
        messages.push({
          messageId: `ksef:${inv.ksefNumber}`,
          channel: 'GOV_PORTAL_API',
          correlationKey: inv.ksefNumber,
          status: 'ksef-purchase-invoice-received',
          rawRef: inv.ksefNumber,
          documentBytes: Buffer.from(xml, 'utf-8'),
          companyId: cfg.companyId,
          providerId: 'ksef',
          syntax: 'FA_VAT',
          senderId: inv.seller?.nip,
        });
      } catch (err) {
        this.log.warn(
          'ksef-inbox',
          `download failed for ${inv.ksefNumber} (company ${cfg.companyId}): ${errMsg(err)}`,
        );
      }
    }
    return messages;
  }

  /**
   * Mirrors `ksef-transmission.ts`'s 4-step auth sequence (challenge → ksef-token → poll status →
   * redeem). Deliberately duplicated rather than shared/imported — the guardrail for this change
   * is to leave the PROVEN send/poll transmit internals untouched.
   */
  private async authenticate(client: KsefClient): Promise<string | null> {
    const challenge = await client.authChallenge();
    const authResponse = await client.authKsefToken(challenge.challenge, challenge.timestampMs);

    let authSuccess = false;
    for (let i = 0; i < 5; i++) {
      const authStatus = await client.authStatus(
        authResponse.referenceNumber,
        authResponse.authenticationToken.token,
      );
      if (authStatus.status.code === 200) {
        authSuccess = true;
        break;
      }
      if (authStatus.status.code >= 400) {
        this.log.warn(
          'ksef-inbox',
          `auth failed (code ${authStatus.status.code}: ${authStatus.status.description})`,
        );
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!authSuccess) {
      this.log.warn('ksef-inbox', 'auth still processing after retries — skipping this poll cycle');
      return null;
    }

    const tokens = await client.authRedeem(authResponse.authenticationToken.token);
    return tokens.accessToken.token;
  }
}
