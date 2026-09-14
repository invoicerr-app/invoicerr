/**
 * The Chorus Pro `AuthorityStatusPoller` — post-deposit
 * conformity tracking (`conformity/authority-status-poller.ts`'s own header), the read-side twin of
 * `transports/chorus-pro-transport.ts`. `transports/chorus-pro/choruspro-client.ts#consulterCr()` calls
 * the ACTUAL Chorus Pro CR endpoint — `POST /cpro/transverses/v1/consulterCRDetaille`, on the
 * "Transverses" API, not "Factures" — established on the official PISTE Swagger 2026-09-14 (see that
 * file's own header for the citation) after the reference's own route
 * (`/cpro/factures/v1/consulter/cr`, kept verbatim from `avant-refonte-documents` and never
 * independently re-verified until then) turned out not to exist at all.
 *
 * ## HONESTY NOTE — what is, and is NOT, verified here
 *
 * Same posture as `ksef-status-poller.ts`'s own header: this checkout holds no PISTE account
 * (`documentation/docs/developer-guide/credentials-guide.md` §3, "Repo status: 🔴 missing"), so
 * `consulterCr`'s own response has NEVER been observed live — the ROUTE and the FIELD NAMES
 * (`etatCourantDepotFlux`, `listeErreurDP`, `listeErreurTechnique`) are Swagger-sourced (2026-09-14,
 * `choruspro-client.ts`'s own header), but the VALUE VOCABULARY `mapChorusProStatus` compares against
 * (VALIDE/REJETE/EN_COURS_DE_TRAITEMENT/DEPOSE/SUSPENDU/MISE_EN_PAIEMENT/MANDATEE/COMPTABILISEE) is
 * still inherited from the reference client, unconfirmed by any Swagger `enum` (that field is typed as
 * a bare `string`). `../../transports/chorus-pro/choruspro.live.spec.ts` (gated `CHORUSPRO_LIVE=1`,
 * SKIPPED today) already exercises `consulterCr` as its own step 4, against a real deposit — this
 * poller calls the SAME client method, never a second, poller-only path; no separate live spec exists
 * for the poller itself since there is nothing left to prove that file does not already cover once
 * real credentials exist.
 *
 * `mapChorusProStatus` (`choruspro-client.ts`) is the ONE vocabulary this poller trusts for
 * `isTerminal`. The `reason` on a rejection now prefers `consulterCRDetaille`'s own structured
 * `erreursDP`/`erreursTechniques` (see `poll()` below) — a real diagnostic instead of the bare status
 * code repeated at itself, which is all the OLD (nonexistent) route's response shape could ever have
 * offered.
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
 *  never grew past fr:202/fr:213 in live proof — Chorus Pro's is wider, per the reference's
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

      // On a rejection, prefer the structured errors `consulterCRDetaille` actually carries
      // (`listeErreurDP`/`listeErreurTechnique` — see `choruspro-client.ts`'s own header) over the bare
      // status code: a `libelleErreurDP`/`libelleErreur` names WHY the flux or a demande de paiement in
      // it was refused, not just THAT it was. Falls back to the status code itself only when Chorus Pro
      // reports a rejection with no error detail attached. `?? []` guards a mocked client in tests that
      // predates these two fields, not a documented "may be absent" case — the real client always
      // returns an array, empty or not (`ChorusProClient#consulterCr`'s own `Array.isArray` guard).
      const errorLabels = [
        ...(cr.erreursTechniques ?? []).map((e) => e.libelleErreur).filter((v): v is string => Boolean(v)),
        ...(cr.erreursDP ?? []).map((e) => e.libelleErreurDP).filter((v): v is string => Boolean(v)),
      ];
      const reason =
        mapped === 'REJECTED' ? (errorLabels.length > 0 ? errorLabels.join('; ') : cr.statutFlux) : undefined;

      // Chorus Pro's own `consulterCRDetaille` carries no "when did this status itself change" field
      // (only the CURRENT `etatCourantDepotFlux`) — "now" is the only honest value for "when THIS poll
      // observed it", the same fallback `pdp-status-poller.ts`/`ksef-status-poller.ts` both use for an
      // event with no platform-supplied timestamp.
      return [
        {
          statusCode: cr.statutFlux,
          reason,
          observedAt: new Date(),
          rawPayload: cr.raw,
        },
      ];
    },
  };
}
