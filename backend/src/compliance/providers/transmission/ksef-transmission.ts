import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';

/** Poland — Krajowy System e-Faktur. A GOV_PORTAL_API system selected via ChannelSpec.providerId='ksef'. */
export class KsefTransmissionProvider implements TransmissionProvider {
  readonly id = 'ksef';
  readonly channel: ChannelType = 'GOV_PORTAL_API';
  /** PROVEN — real CLEARED status + ksefNumber obtained end-to-end (2026-06-28). */
  readonly maturity: ProviderMaturity = 'PROVEN';
  readonly feedback = 'ASYNC_POLL' as const; // poll KSeF for the UPO / reference number
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select',
        name: 'environment',
        label: 'KSeF environment',
        required: true,
        options: [
          { label: 'Test', value: 'TEST' },
          { label: 'Production', value: 'PROD' },
        ],
        default: 'TEST',
      },
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
      return {
        channel: 'GOV_PORTAL_API',
        status: 'SKIPPED',
        notes: ['ksef: incomplete config (nip and authToken required)'],
      };
    }

    // Find the FA_VAT artifact
    const faVatArtifact = _artifacts.find((a) => a.syntax === 'FA_VAT');
    if (!faVatArtifact) {
      return { channel: 'GOV_PORTAL_API', status: 'SKIPPED', notes: ['ksef: no FA_VAT artifact'] };
    }

    const companyId = _ctx.supplierCompanyId;
    if (!companyId) {
      return {
        channel: 'GOV_PORTAL_API',
        status: 'SKIPPED',
        notes: ['ksef: no supplierCompanyId in context'],
      };
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

      const xmlContent =
        typeof faVatArtifact.bytes === 'string'
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
        const authStatus = await client.authStatus(
          authResponse.referenceNumber,
          authResponse.authenticationToken.token,
        );
        if (authStatus.status.code === 200) {
          authSuccess = true;
          break;
        }
        if (authStatus.status.code >= 400) {
          return {
            channel: 'GOV_PORTAL_API',
            status: 'REJECTED',
            notes: [`ksef: auth failed (code ${authStatus.status.code}: ${authStatus.status.description})`],
          };
        }
        // Still processing (100) — wait and retry
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!authSuccess) {
        return {
          channel: 'GOV_PORTAL_API',
          status: 'PENDING',
          notes: ['ksef: auth still processing after retries'],
        };
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
      log.info(
        'transmission/ksef',
        `submitted → session ${session.referenceNumber}, invoice ${invoiceResult.referenceNumber} (key ${key})`,
      );

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
        return {
          channel: 'GOV_PORTAL_API',
          status: 'PENDING',
          ref,
          notes: ['ksef: credentials no longer active'],
        };
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
        const authStatus = await client.authStatus(
          authResponse.referenceNumber,
          authResponse.authenticationToken.token,
        );
        if (authStatus.status.code === 200) {
          authSuccess = true;
          break;
        }
        if (authStatus.status.code >= 400) {
          return {
            channel: 'GOV_PORTAL_API',
            status: 'PENDING',
            ref,
            notes: [`ksef: poll auth failed (code ${authStatus.status.code})`],
          };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!authSuccess) {
        return {
          channel: 'GOV_PORTAL_API',
          status: 'PENDING',
          ref,
          notes: ['ksef: poll auth still processing'],
        };
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

        // §3.1 UPO archival: persist the Urzędowe Poświadczenie Odbioru download reference.
        // The KSeF API exposes upoDownloadUrl directly on the invoice status response.
        // We store it as an authorityId with scheme='UPO' so the lifecycle layer can
        // retrieve/download the official acknowledgement for archival.
        const authorityIds: import('../../execution/types').AuthorityIdentifier[] = [];
        if (status.ksefNumber) {
          authorityIds.push({ scheme: 'KSEF_NUMBER', value: status.ksefNumber });
        }
        if (status.upoDownloadUrl) {
          authorityIds.push({ scheme: 'UPO', value: status.upoDownloadUrl });
          notes.push(`upoUrl: ${status.upoDownloadUrl}`);
        }

        // Also try to fetch the UPO pages from session status (contains multiple invoice UPOs)
        if (!status.upoDownloadUrl) {
          try {
            const sessionSt = await client.sessionStatus(sessionRef, tokens.accessToken.token);
            if (sessionSt.upo?.pages?.length) {
              const upoPage = sessionSt.upo.pages[0];
              authorityIds.push({ scheme: 'UPO', value: upoPage.downloadUrl });
              notes.push(`upoUrl: ${upoPage.downloadUrl}`);
            }
          } catch {
            // UPO page fetch is non-blocking — clearance is still valid without it
          }
        }

        return { channel: 'GOV_PORTAL_API', status: 'CLEARED', ref, notes, authorityIds };
      }
      if (code === 100 || code === 150) {
        // 100 = accepted for processing, 150 = still processing → PENDING
        return { channel: 'GOV_PORTAL_API', status: 'PENDING', ref, notes: [] };
      }
      if (code >= 400) {
        // Rejected / semantic error
        return {
          channel: 'GOV_PORTAL_API',
          status: 'REJECTED',
          ref,
          notes: [`ksef: code ${code}: ${status.status.description}`],
        };
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
