/**
 * The ANAF `AuthorityStatusPoller` — root TODO item 10's own named remainder (post-upload conformity
 * tracking, `conformity/authority-status-poller.ts`'s own header), the read-side twin of
 * `transports/anaf-transport.ts`. `stareMesaj` (`GET {baseUrl}/stareMesaj?id_incarcare={id}`) is the
 * repère's own status-consultation endpoint (`compliance/providers/transmission/anaf-client.ts`,
 * `avant-refonte-documents`) — wired here, never an invented one; `transports/anaf/anaf-client.ts`
 * REPRISES it (see that file's own header for the real XML shape and host).
 *
 * `mapAnafStatus` (`transports/anaf/anaf-client.ts`) is the ONE vocabulary this poller trusts for BOTH
 * `isTerminal` and the synthetic `reason` on a rejection — never a second, poller-local copy of the
 * same mapping table, the same discipline `chorus-pro-status-poller.ts`'s own header holds for
 * `mapChorusProStatus`.
 *
 * ## HONESTY NOTE — what is, and is NOT, verified here
 *
 * Same posture as `chorus-pro-status-poller.ts`'s/`ksef-status-poller.ts`'s own header: this checkout
 * holds no ANAF sandbox credentials (`CREDENTIALS_GUIDE.md` §5, "Repo status: 🔴 missing"), so
 * `stareMesaj`'s own response shape has NEVER been observed live — the `stare` vocabulary
 * (`'in prelucrare'`/`'ok'`/`'nok'`) and the `<Errors errorMessage="…">` child come from ANAF's own
 * published documentation and the repère's own client, never a live capture.
 */
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import { mapAnafStatus } from '../../transports/anaf/anaf-client';
import {
  ANAF_PROVIDER_ID,
  AnafCredentials,
  buildAnafClient,
  extractAnafCredentials,
} from '../../transports/anaf-transport';
import {
  AuthorityStatusPoller,
  ChannelNotConnectedError,
  RawAuthorityEvent,
} from '../authority-status-poller';

export { ANAF_PROVIDER_ID };

/** A `stare` is terminal exactly when `mapAnafStatus` no longer calls it PENDING — CLEARED (`ok`) and
 *  REJECTED (`nok`, or anything carrying an "erori"/"error" token) alike, the same "predicate over
 *  the provider's own open vocabulary" shape `chorus-pro-status-poller.ts`'s own `isTerminal` already
 *  holds, never a fixed two-code list the way `pdp-status-poller.ts` can afford. */
function isTerminalAnafStatus(statusCode: string): boolean {
  const mapped = mapAnafStatus(statusCode);
  return mapped === 'CLEARED' || mapped === 'REJECTED';
}

export interface AnafStatusPollerDeps {
  channelCredentials: ChannelCredentialsService;
}

async function resolveAnafConfig(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<{ resolved: ResolvedChannelConfig; credentials: AnafCredentials }> {
  const resolved = await channelCredentials.resolveActive(companyId, ANAF_PROVIDER_ID);
  const credentials = resolved && extractAnafCredentials(resolved);
  if (!resolved || !credentials) {
    throw new ChannelNotConnectedError(ANAF_PROVIDER_ID);
  }
  return { resolved, credentials };
}

export function buildAnafStatusPoller(deps: AnafStatusPollerDeps): AuthorityStatusPoller {
  return {
    providerId: ANAF_PROVIDER_ID,
    isTerminal: isTerminalAnafStatus,

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const { resolved, credentials } = await resolveAnafConfig(deps.channelCredentials, companyId);
      const client = buildAnafClient(credentials, resolved.environment);

      const status = await client.getStatus(transportRef);
      const mapped = mapAnafStatus(status.stare);

      // ANAF's own `stareMesaj` carries no "when did this status itself change" field (only the
      // CURRENT `stare`) — "now" is the only honest value for "when THIS poll observed it", the same
      // fallback `pdp-status-poller.ts`/`chorus-pro-status-poller.ts` both use for an event with no
      // platform-supplied timestamp.
      return [
        {
          statusCode: status.stare,
          reason: mapped === 'REJECTED' ? status.errors.join('; ') || status.stare : undefined,
          observedAt: new Date(),
          rawPayload: status.raw,
        },
      ];
    },
  };
}
