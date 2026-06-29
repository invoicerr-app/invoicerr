/**
 * Malaysia MyInvois (LHDNM) transmission provider — scaffold, live-deferred.
 *
 * Wraps MyInvoisClient to implement the TransmissionProvider interface.
 * Flow: authenticate (OAuth2) → submit UBL 2.1 → poll for "Valid" status → CLEARED.
 * Ref format: "{companyId}|{uuid}" where uuid is the MyInvois document UUID.
 *
 * Missing for real integration (live-deferred):
 *   - LHDNM-specific UBL 2.1 extensions (cbc:ProfileID, cac:Signature block)
 *   - SHA-256 hash of document bytes (implemented in client, needs real UBL artifact)
 *   - Webhook/SSE for push status updates (alternative to polling)
 *   - Long ID (QR link) embedding in the final invoice PDF after clearance
 *   - Buyer rejection / seller cancellation flows
 *
 * LIVE PROOF: DEFERRED — no public MyInvois sandbox client_id/secret available.
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { MyInvoisClient, MyInvoisHttpPort } from './myinvois-client';

const GP: ChannelType = 'GOV_PORTAL_API';

export class MyInvoisTransmissionProvider implements TransmissionProvider {
  readonly id = 'myinvois';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 4, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select', name: 'environment', label: 'MyInvois environment', required: true,
        options: [
          { label: 'Pre-production (sandbox)', value: 'preprod' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'preprod',
      },
      { type: 'text', name: 'clientId', label: 'MyInvois Client ID', required: true },
      { type: 'text', name: 'clientSecret', label: 'MyInvois Client Secret', required: true, secret: true },
      { type: 'text', name: 'tin', label: 'Seller TIN (e.g. C12345678900)', required: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: MyInvoisHttpPort,
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
      return { channel: GP, status: 'SKIPPED', notes: ['myinvois: no resolved config (client_id + secret required)'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'preprod').toLowerCase() as 'preprod' | 'prod';
    const clientId = config.clientId as string;
    const clientSecret = config.clientSecret as string;
    const tin = config.tin as string;

    if (!clientId || !clientSecret) {
      return { channel: GP, status: 'SKIPPED', notes: ['myinvois: clientId and clientSecret required'] };
    }
    if (!tin) {
      return { channel: GP, status: 'SKIPPED', notes: ['myinvois: TIN required'] };
    }

    // MyInvois accepts EN16931_UBL (UBL 2.1) from the Malaysia profile
    const ublArtifact = artifacts.find((a) => a.syntax === 'EN16931_UBL');
    if (!ublArtifact) {
      return { channel: GP, status: 'SKIPPED', notes: ['myinvois: no EN16931_UBL artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: GP, status: 'SKIPPED', notes: ['myinvois: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStubHttpPort();
    try {
      const client = new MyInvoisClient(http, { environment: env, clientId, clientSecret, tin });
      const docNo = ctx.externalRef ?? `INV-${Date.now()}`;
      log.info('transmission/myinvois', `submitting UBL to MyInvois (TIN ${tin}, key ${key})`);
      const resp = await client.submitInvoice(ublArtifact.bytes, docNo);

      if (resp.rejectedDocuments.length > 0) {
        const errs = resp.rejectedDocuments.map((r) => `${r.error.code}: ${r.error.message}`).join('; ');
        return { channel: GP, status: 'REJECTED', notes: [`myinvois: rejected — ${errs}`] };
      }

      const accepted = resp.acceptedDocuments[0];
      if (!accepted) {
        return { channel: GP, status: 'REJECTED', notes: ['myinvois: no accepted documents in response'] };
      }

      const ref = `${companyId}|${accepted.uuid}`;
      log.info('transmission/myinvois', `submitted → uuid ${accepted.uuid}, submissionUID ${resp.submissionUID} (key ${key})`);
      return {
        channel: GP,
        status: 'PENDING', // MyInvois validates async; poll for "Valid"
        ref,
        notes: [`uuid: ${accepted.uuid}`, `submissionUID: ${resp.submissionUID}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/myinvois', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`myinvois: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: GP, status: 'PENDING', ref, notes: ['myinvois: invalid ref'] };
    const [companyId, uuid] = parts;
    if (!this.credentials) {
      log.todo('transmission/myinvois', `poll MyInvois document ${uuid}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['myinvois: poll deferred (use /api/v1.0/documents/{uuid}/details)'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'myinvois');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['myinvois: credentials inactive'] };
      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'preprod').toLowerCase() as 'preprod' | 'prod';
      const http = this.httpPort ?? buildStubHttpPort();
      const client = new MyInvoisClient(http, {
        environment: env,
        clientId: config.clientId as string,
        clientSecret: config.clientSecret as string,
        tin: config.tin as string,
      });
      const details = await client.getStatus(uuid);
      if (details.status === 'Valid') {
        return {
          channel: GP, status: 'CLEARED', ref,
          authorityIds: [{ scheme: 'MYINVOIS_UUID', value: uuid }, { scheme: 'LONG_ID', value: details.longId }],
          notes: [`myinvois: Valid — longId: ${details.longId}`],
        };
      }
      if (details.status === 'Invalid') {
        return { channel: GP, status: 'REJECTED', ref, notes: [`myinvois: Invalid — ${details.documentStatusReason ?? 'no reason'}`] };
      }
      if (details.status === 'Cancelled') {
        return { channel: GP, status: 'REJECTED', ref, notes: ['myinvois: Cancelled'] };
      }
      return { channel: GP, status: 'PENDING', ref, notes: [`myinvois: status ${details.status}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/myinvois', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`myinvois: poll error: ${msg}`] };
    }
  }
}

function buildStubHttpPort(): MyInvoisHttpPort {
  return {
    getToken: async () => { throw new Error('MyInvoisHttpPort not implemented — client_id + secret required'); },
    submitDocuments: async () => { throw new Error('MyInvoisHttpPort not implemented — live MyInvois credentials required'); },
    getDocumentDetails: async () => { throw new Error('MyInvoisHttpPort not implemented'); },
  };
}
