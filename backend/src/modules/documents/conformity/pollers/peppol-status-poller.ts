/**
 * The THIRD `AuthorityStatusPoller` — the generic Peppol Access Point, via its own `getStatus()`
 * (`transports/peppol/peppol-client.ts`). Same shape `pdp-status-poller.ts`/`ksef-status-poller.ts`
 * already hold: a document's `channelProviderId === 'peppol'` and a non-empty `transportRef` (the
 * AP-assigned message id) are all the sweep needs to poll this.
 *
 * UNLIKE `pdp-status-poller.ts`'s own `events[]` (a FULL timeline in one response), the generic AP
 * port only ever exposes the CURRENT status, singular (`GET /api/v1/status/{messageId}` →
 * `{status}`) — the same "common REST denominator" shape `peppol-client.ts`'s own header already
 * documents. This poller journals exactly that ONE current status every pass; the `@@unique
 * ([documentId, providerId, statusCode])` dedup (`authority-events.persistence.ts`) is what keeps a
 * document stuck at, say, "SENT" for several sweeps from journaling the SAME row over and over — only
 * a genuine status CHANGE (SENT → DELIVERED, or → FAILED) ever produces a new one.
 *
 * `DELIVERED`/`FAILED` are the two terminal outcomes this port's own vocabulary defines (see
 * `peppol-client.ts`'s own `PeppolDeliveryStatus`) — `QUEUED`/`SENT`/`UNKNOWN` are all still "keep
 * polling", exactly like PDP's own fr:200/fr:201 are intermediate before fr:202/fr:213.
 */
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import { extractPeppolCredentials, PEPPOL_PROVIDER_ID } from '../../transports/peppol-transport';
import { PeppolApHttpClient } from '../../transports/peppol/peppol-client';
import {
  AuthorityStatusPoller,
  ChannelNotConnectedError,
  RawAuthorityEvent,
} from '../authority-status-poller';

export { PEPPOL_PROVIDER_ID };

export interface PeppolStatusPollerDeps {
  channelCredentials: ChannelCredentialsService;
}

async function resolvePeppolConfig(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<ResolvedChannelConfig> {
  const resolved = await channelCredentials.resolveActive(companyId, PEPPOL_PROVIDER_ID);
  if (!resolved || !extractPeppolCredentials(resolved)) {
    throw new ChannelNotConnectedError(PEPPOL_PROVIDER_ID);
  }
  return resolved;
}

export function buildPeppolStatusPoller(deps: PeppolStatusPollerDeps): AuthorityStatusPoller {
  return {
    providerId: PEPPOL_PROVIDER_ID,
    isTerminal: (statusCode) => statusCode === 'DELIVERED' || statusCode === 'FAILED',

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const resolved = await resolvePeppolConfig(deps.channelCredentials, companyId);
      const credentials = extractPeppolCredentials(resolved)!; // resolvePeppolConfig already proved non-null

      const client = new PeppolApHttpClient({
        accessPointUrl: credentials.accessPointUrl,
        apiKey: credentials.apiKey,
        environment: credentials.environment,
      });
      const status = await client.getStatus(transportRef);

      return [
        {
          statusCode: status.status,
          statusText: status.mlrCode,
          reason: status.status === 'FAILED' ? status.mlrDescription : undefined,
          observedAt: new Date(),
          rawPayload: status,
        },
      ];
    },
  };
}
