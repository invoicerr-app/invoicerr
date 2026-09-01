/**
 * The FIRST `AuthorityStatusPoller` — France's PDP. Proven LIVE this session: a real deposit reaches
 * `fr:202` ("Reçue par la plateforme") within ~1s of upload, past `fr:200` ("Déposée (validée)") and
 * `fr:201` ("Émise par la plateforme"), reproduced five times against the superpdp sandbox (see
 * `pdp/pdp-conformity.live.spec.ts`). A rejection surfaces as `fr:213`, carrying `data.reason` on the
 * event itself — also reproduced live this session (see that same live spec for how, since a
 * deliberately non-compliant deposit had become hard to produce once root TODO item 15's own content
 * requirements matured — this file's own poll/journal MECHANICS are proven against the real fr:213
 * payload captured then, not invented).
 *
 * LEÇON DE SESSION CRITIQUE (this task's own brief, and `pdp/pdp-client.ts`'s own header): the old
 * poller read `invoice.status_code` — a field the API does NOT return — which is why "PDP proven
 * live" stayed green while every real deposit was silently PENDING forever. The lifecycle lives in
 * `events[]`, and ONLY there. This poller reads `events[]` and nothing else.
 */
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import { extractPdpCredentials } from '../../transports/pdp-transport';
import { PdpClient, SuperPdpInvoiceEvent } from '../../transports/pdp/pdp-client';
import {
  AuthorityStatusPoller,
  ChannelNotConnectedError,
  RawAuthorityEvent,
} from '../authority-status-poller';

export const PDP_PROVIDER_ID = 'pdp';

/** fr:202 ("Reçue par la plateforme" — the platform's own final ACCEPTANCE) and fr:213 ("Rejetée") —
 *  the only two codes this session's own live proof ever observed ending a deposit's lifecycle. Every
 *  other code PDP emits (fr:200, fr:201, and any lifecycle-push code like fr:211/fr:212 a SELLER might
 *  push — `pdp-client.ts#pushLifecycleStatus` — which this poller never sends) is intermediate: still
 *  journaled (the whole point of a timeline), just never terminal. */
export const PDP_ACCEPTED_STATUS_CODE = 'fr:202';
export const PDP_REJECTED_STATUS_CODE = 'fr:213';

export interface PdpStatusPollerDeps {
  channelCredentials: ChannelCredentialsService;
}

function hasStatusCode(event: SuperPdpInvoiceEvent): event is SuperPdpInvoiceEvent & { status_code: string } {
  return typeof event.status_code === 'string' && event.status_code.length > 0;
}

async function resolvePdpConfig(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<ResolvedChannelConfig> {
  const resolved = await channelCredentials.resolveActive(companyId, PDP_PROVIDER_ID);
  if (!resolved || !extractPdpCredentials(resolved)) {
    throw new ChannelNotConnectedError(PDP_PROVIDER_ID);
  }
  return resolved;
}

export function buildPdpStatusPoller(deps: PdpStatusPollerDeps): AuthorityStatusPoller {
  return {
    providerId: PDP_PROVIDER_ID,
    isTerminal: (statusCode) =>
      statusCode === PDP_ACCEPTED_STATUS_CODE || statusCode === PDP_REJECTED_STATUS_CODE,

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const resolved = await resolvePdpConfig(deps.channelCredentials, companyId);
      const credentials = extractPdpCredentials(resolved)!; // resolvePdpConfig already proved non-null

      const client = new PdpClient({ ...credentials, apiStyle: 'superpdp' });
      const invoiceId = Number(transportRef);
      const invoice = await client.getInvoice(invoiceId);

      // `events[]` — see this file's own header. An invoice with none yet (a very fresh deposit the
      // platform hasn't even started evaluating) simply yields nothing to journal this pass; the next
      // pass tries again, exactly like a document still waiting for fr:200 always would.
      return (invoice.events ?? []).filter(hasStatusCode).map(
        (event): RawAuthorityEvent => ({
          statusCode: event.status_code,
          statusText: event.status_text,
          reason: event.data?.reason,
          observedAt: event.created_at ? new Date(event.created_at) : new Date(),
          rawPayload: event,
        }),
      );
    },
  };
}
