/**
 * The Chorus Pro `AuthorityStatusPoller` — root TODO item 10's own named remainder (post-deposit
 * conformity tracking, `conformity/authority-status-poller.ts`'s own header), the read-side twin of
 * `transports/chorus-pro-transport.ts`. The repère's own client (`avant-refonte-documents`,
 * `compliance/providers/transmission/choruspro-client.ts`) DID carry a usable status method —
 * `consulterCr(numeroFluxDepot)` (`POST /cpro/factures/v1/consulter/cr` → `statutFlux`) — so this is
 * that endpoint, wired, never an invented one; `transports/chorus-pro/choruspro-client.ts` REPRISES it
 * verbatim (see that file's own header).
 *
 * ## HONESTY NOTE — what is, and is NOT, verified here
 *
 * Same posture as `ksef-status-poller.ts`'s own header: this checkout holds no PISTE account
 * (`CREDENTIALS_GUIDE.md` §3, "Repo status: 🔴 missing"), so `consulterCr`'s own response shape has
 * NEVER been observed live — the field names (`statutFlux`, the vocabulary VALIDE/REJETE/
 * EN_COURS_DE_TRAITEMENT/DEPOSE/SUSPENDU/MISE_EN_PAIEMENT/MANDATEE/COMPTABILISEE) come from the
 * repère's own client, which itself cites the "API Dépôt flux G2B" v5.2.0 documentation rather than a
 * live capture (see `choruspro-client.ts`'s own header). `../../transports/chorus-pro/
 * choruspro-live.spec.ts` (gated `CHORUSPRO_LIVE=1`, SKIPPED today) already exercises `consulterCr`
 * as its own step 4, against a real deposit — this poller calls the SAME client method, never a
 * second, poller-only path; no separate live spec exists for the poller itself since there is nothing
 * left to prove that file does not already cover once real credentials exist.
 *
 * `mapChorusProStatus` (`choruspro-client.ts`) is the ONE vocabulary this poller trusts for BOTH
 * `isTerminal` and the synthetic `reason` on a rejection — never a second, poller-local copy of the
 * same mapping table.
 */
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import {
  ChorusProClient,
  FetchChorusProHttpPort,
  mapChorusProStatus,
} from '../../transports/chorus-pro/choruspro-client';
import {
  CHORUS_PRO_PROVIDER_ID,
  CHORUS_PRO_URLS,
  ChorusProCredentials,
  extractChorusProCredentials,
} from '../../transports/chorus-pro-transport';
import {
  AuthorityStatusPoller,
  ChannelNotConnectedError,
  RawAuthorityEvent,
} from '../authority-status-poller';

export { CHORUS_PRO_PROVIDER_ID };

/** A `statutFlux` is terminal exactly when `mapChorusProStatus` no longer calls it PENDING — CLEARED
 *  (VALIDE/MISE_EN_PAIEMENT/MANDATEE/COMPTABILISEE) and REJECTED (REJETE) alike, the same "predicate
 *  over the provider's own vocabulary" shape `peppol-status-poller.ts`'s own `isTerminal` already
 *  holds, never a fixed two-code list the way `pdp-status-poller.ts` can afford (PDP's own vocabulary
 *  never grew past fr:202/fr:213 in this session's live proof — Chorus Pro's is wider, per the repère's
 *  own client). */
function isTerminalChorusProStatus(statusCode: string): boolean {
  const mapped = mapChorusProStatus(statusCode);
  return mapped === 'CLEARED' || mapped === 'REJECTED';
}

export interface ChorusProStatusPollerDeps {
  channelCredentials: ChannelCredentialsService;
}

/** Same "one instance per call, no shared cross-request state beyond the client's own short-lived
 *  token cache" choice `chorus-pro-transport.ts#buildClient` makes — kept as a SEPARATE, small copy
 *  here rather than importing that transport's own (unexported) helper: this poller has no other
 *  reason to depend on the transport module beyond its exported credential/URL constants. */
function buildClient(credentials: ChorusProCredentials): ChorusProClient {
  const urls = CHORUS_PRO_URLS[credentials.environment];
  return new ChorusProClient({ ...urls, ...credentials }, new FetchChorusProHttpPort());
}

async function resolveChorusProConfig(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<ResolvedChannelConfig> {
  const resolved = await channelCredentials.resolveActive(companyId, CHORUS_PRO_PROVIDER_ID);
  if (!resolved || !extractChorusProCredentials(resolved)) {
    throw new ChannelNotConnectedError(CHORUS_PRO_PROVIDER_ID);
  }
  return resolved;
}

export function buildChorusProStatusPoller(deps: ChorusProStatusPollerDeps): AuthorityStatusPoller {
  return {
    providerId: CHORUS_PRO_PROVIDER_ID,
    isTerminal: isTerminalChorusProStatus,

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const resolved = await resolveChorusProConfig(deps.channelCredentials, companyId);
      const credentials = extractChorusProCredentials(resolved)!; // proved non-null above
      const client = buildClient(credentials);

      const cr = await client.consulterCr(transportRef);
      const mapped = mapChorusProStatus(cr.statutFlux);

      // Chorus Pro's own `consulterCr` carries no "when did this status itself change" field (only
      // the CURRENT `statutFlux`) — "now" is the only honest value for "when THIS poll observed it",
      // the same fallback `pdp-status-poller.ts`/`ksef-status-poller.ts` both use for an event with no
      // platform-supplied timestamp.
      return [
        {
          statusCode: cr.statutFlux,
          reason: mapped === 'REJECTED' ? cr.statutFlux : undefined,
          observedAt: new Date(),
          rawPayload: cr.raw,
        },
      ];
    },
  };
}
