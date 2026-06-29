/**
 * Egypt ETA e-invoicing transmission provider — scaffold, live-deferred.
 *
 * Scaffold depth: configSchema + injectable HTTP + UUID/hash/sign seams + submit/poll.
 *
 * Key seams (wired, not implemented):
 *  - ETA canonicalization (etaCanonicalize) — lowercase keys, sorted, no nulls.
 *  - UUID computation (computeEtaUuid) — SHA-256 of canonical JSON.
 *  - Signing: Ed25519/RSA via the signing port (seam present, not called in scaffold).
 *
 * Ref format: "{companyId}|{uuid}"
 *
 * Missing for live:
 *  - Real ETA document schema (invoiceLines, totalAmount, etc.).
 *  - Signing port integration (XAdES or ETA native signing).
 *  - ETA validation response parsing (acceptedDocuments, rejectedDocuments).
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { EtaClient, EtaHttpPort, computeEtaUuid, etaCanonicalize, mapEtaStatus } from './eg-eta-client';

const GP: ChannelType = 'GOV_PORTAL_API';

const ETA_URLS = {
  test: {
    baseUrl: 'https://api.preprod.invoicing.eta.gov.eg',
    tokenUrl: 'https://id.preprod.eta.gov.eg',
  },
  prod: {
    baseUrl: 'https://api.invoicing.eta.gov.eg',
    tokenUrl: 'https://id.eta.gov.eg',
  },
};

const ETA_CONFIG_SCHEMA: ChannelConfigSchema = {
  fields: [
    {
      type: 'select', name: 'environment', label: 'ETA environment', required: true,
      options: [{ label: 'Pre-production (Test)', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
    },
    { type: 'text', name: 'taxRegistrationNumber', label: 'Tax Registration Number (TIN/RIN)', required: true },
    { type: 'text', name: 'clientId', label: 'ETA OAuth2 Client ID', required: true },
    { type: 'text', name: 'clientSecret', label: 'ETA OAuth2 Client Secret', required: true, secret: true },
    {
      type: 'select', name: 'signatureType', label: 'Signature algorithm', required: true,
      options: [
        { label: 'Ed25519 (resident taxpayer)', value: 'ed25519' },
        { label: 'RSA-2048 (non-resident)', value: 'rsa' },
      ], default: 'ed25519',
    },
  ],
};

/** Stub HTTP port — replaced by a real client or a mock in tests. */
const STUB_HTTP: EtaHttpPort = {
  post: async () => { throw new Error('ETA HTTP port not implemented — provide real credentials + HTTP client'); },
  get: async () => { throw new Error('ETA HTTP port not implemented'); },
};

export class EgEtaTransmissionProvider implements TransmissionProvider {
  readonly id = 'eg-eta';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = ETA_CONFIG_SCHEMA;

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
      return { channel: GP, status: 'SKIPPED', notes: ['eg-eta: no resolved config — configure ETA credentials'] };
    }
    const { config, environment } = resolvedConfig;
    const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
    const urls = isTest ? ETA_URLS.test : ETA_URLS.prod;
    const clientId = (config.clientId ?? '') as string;
    const clientSecret = (config.clientSecret ?? '') as string;
    const tin = (config.taxRegistrationNumber ?? '') as string;

    // ETA format is EG_ETA (JSON-based); look for that syntax.
    const art = artifacts.find((a) => a.syntax === 'EG_ETA');
    if (!art) return { channel: GP, status: 'SKIPPED', notes: ['eg-eta: no EG_ETA artifact'] };
    const companyId = ctx.supplierCompanyId;
    if (!companyId) return { channel: GP, status: 'SKIPPED', notes: ['eg-eta: no supplierCompanyId'] };

    log.info('transmission/eg-eta', `submitting ETA document (TIN ${tin}, key ${key})`);

    // TODO: deserialize the artifact bytes to an ETA JSON document.
    // TODO: call etaCanonicalize() → computeEtaUuid() → sign via signing port.
    // For now, build a minimal scaffold document:
    const rawContent = Buffer.isBuffer(art.bytes) ? art.bytes.toString('utf-8') : new TextDecoder().decode(art.bytes);
    let docPayload: Record<string, unknown>;
    try {
      docPayload = JSON.parse(rawContent) as Record<string, unknown>;
    } catch {
      // EG_ETA artifact may be XML in the scaffold; wrap it
      docPayload = { rawDocument: rawContent, issuerTaxpayerTin: tin };
    }

    // Canonicalize and compute UUID (seam — real implementation below)
    const canonical = etaCanonicalize(docPayload);
    const uuid = computeEtaUuid(canonical); // TODO: replace stub with crypto.createHash

    log.todo('transmission/eg-eta', 'sign ETA document via signing port (Ed25519 / RSA-2048)');

    const client = new EtaClient(
      { baseUrl: urls.baseUrl, tokenUrl: urls.tokenUrl, clientId, clientSecret, taxRegistrationNumber: tin },
      STUB_HTTP,
    );

    try {
      const result = await client.submitDocument({ ...docPayload, uuid });
      const ref = `${companyId}|${result.uuid || uuid}`;
      log.info('transmission/eg-eta', `submitted → uuid ${result.uuid || uuid} (key ${key})`);
      return { channel: GP, status: 'PENDING', ref, notes: [`uuid: ${result.uuid || uuid}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/eg-eta', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`eg-eta: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: GP, status: 'PENDING', ref, notes: ['eg-eta: invalid ref'] };
    const [companyId, uuid] = parts;
    if (!this.credentials) {
      log.todo('transmission/eg-eta', `poll ETA status for uuid ${uuid}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['eg-eta: no credentials port'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'eg-eta');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['eg-eta: credentials inactive'] };
      const { config, environment } = resolved;
      const isTest = ((config.environment as string) ?? environment ?? 'test').toLowerCase() !== 'prod';
      const urls = isTest ? ETA_URLS.test : ETA_URLS.prod;
      const clientId = (config.clientId ?? '') as string;
      const clientSecret = (config.clientSecret ?? '') as string;
      const tin = (config.taxRegistrationNumber ?? '') as string;
      const client = new EtaClient(
        { baseUrl: urls.baseUrl, tokenUrl: urls.tokenUrl, clientId, clientSecret, taxRegistrationNumber: tin },
        STUB_HTTP,
      );
      const resp = await client.getDocumentStatus(uuid);
      const status = mapEtaStatus(resp.status);
      return { channel: GP, status, ref, notes: [`eg-eta: ${resp.status}`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/eg-eta', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`eg-eta: poll error: ${msg}`] };
    }
  }
}
