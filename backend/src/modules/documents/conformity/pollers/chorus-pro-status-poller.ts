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
 * ## HONESTY NOTE — what is, and is NOT, verified here (UPDATED 2026-09-14)
 *
 * A real qualification round-trip now exists — `consulterCr`'s response HAS been observed live
 * (`../../transports/chorus-pro/choruspro.live.spec.ts`, `CHORUSPRO_LIVE=1`, 2026-09-14): a deposit
 * reached the terminal `IN_INTEGRE` state with `listeErreurDP: []` (see
 * `documentation/docs/developer-guide/credentials-guide.md` §3 for the full citation), superseding
 * this note's own earlier claim that no PISTE account existed in this checkout. The ROUTE and FIELD
 * NAMES (`etatCourantDepotFlux`, `listeErreurDP`, `listeErreurTechnique`) are confirmed correct by
 * that round-trip, not merely Swagger-sourced any more.
 *
 * **The VALUE VOCABULARY `mapChorusProStatus` compares against was found CONFIRMED WRONG the same
 * day, and FIXED the same day** — see that function's own doc comment (`choruspro-client.ts`) for the
 * full detail: the real values observed (`IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP`, `IN_REJETE`,
 * `IN_INTEGRE`) all carry an `IN_` prefix the vocabulary at the time did not recognize, so this
 * poller's own `isTerminalChorusProStatus` below never reported a real deposit as terminal — a real
 * rejection or a real `IN_INTEGRE` acceptance both read as PENDING, forever. Now fixed:
 * `mapChorusProStatus` recognizes all three `IN_`-prefixed values (plus the bare vocabulary it already
 * had), and a value it still does not recognize maps to its own `UNKNOWN` outcome — never silently
 * PENDING again — which `poll()` below persists a log for (see there). `choruspro.live.spec.ts`
 * already exercises `consulterCr` as its own step 4, against the real deposit — this poller calls the
 * SAME client method, never a second, poller-only path.
 *
 * `mapChorusProStatus` (`choruspro-client.ts`) is the ONE vocabulary this poller trusts for
 * `isTerminal`. The `reason` on a rejection now prefers `consulterCRDetaille`'s own structured
 * `erreursDP`/`erreursTechniques` (see `poll()` below) — a real diagnostic instead of the bare status
 * code repeated at itself, which is all the OLD (nonexistent) route's response shape could ever have
 * offered.
 */
import { logger } from '@/logger/logger.service';
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

/** A `statutFlux` is terminal exactly when `mapChorusProStatus` calls it CLEARED
 *  (VALIDE/MISE_EN_PAIEMENT/MANDATEE/COMPTABILISEE/IN_INTEGRE) or REJECTED (REJETE/IN_REJETE) — the
 *  same "predicate over the provider's own vocabulary" shape `ksef-status-poller.ts`'s own
 *  `isTerminalKsefCode` already holds, never a fixed two-code list the way `pdp-status-poller.ts` can afford
 *  (PDP's own vocabulary never grew past fr:202/fr:213 in live proof — Chorus Pro's is wider, per the
 *  reference's own client). PENDING and UNKNOWN are BOTH non-terminal here, deliberately the same way:
 *  an unrecognized value has no more basis to be read as a success or a failure than a recognized
 *  in-flight one does — see `mapChorusProStatus`'s own doc comment for why UNKNOWN exists at all and
 *  is never silently folded into PENDING at the LOGGING level, only at this terminality check. */
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
  // Per-deposit "last unrecognized status already logged" — see the comment on the `if` below for
  // why this exists. Deliberately IN-MEMORY, not a DB check: `buildChorusProStatusPoller` is called
  // ONCE, at boot, so this Map lives for the lifetime of THIS worker process, exactly the boundary a
  // best-effort de-dup needs — a restart (or, with `docker-compose.scale.yml`'s dedicated workers,
  // each separate process) simply re-logs once more, which is the acceptable, honest cost of not
  // adding a new DB query (or a new indexed column — a schema change out of this fix's own scope) to
  // every single poll tick just to de-duplicate a log line. Grows by one entry per DISTINCT
  // transportRef that ever hits an unrecognized status while this process is up — an edge case (most
  // deposits resolve into a KNOWN status), so unbounded growth here is an accepted, proportionate
  // trade-off, not a general-purpose cache.
  const lastLoggedUnknownStatus = new Map<string, string>();

  return {
    providerId: CHORUS_PRO_PROVIDER_ID,
    isTerminal: isTerminalChorusProStatus,

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const resolved = await resolveChorusProConfig(deps.channelCredentials, companyId);
      const credentials = extractChorusProCredentials(resolved)!; // proved non-null above
      const client = buildClient(credentials);

      const cr = await client.consulterCr(transportRef);
      const mapped = mapChorusProStatus(cr.statutFlux);

      // Never silent — see `mapChorusProStatus`'s own doc comment for the full rationale. Persisted
      // (not the raw Nest logger `conformity-sweep-runner.ts` uses for its OWN operational logging) so
      // an admin can find it in Settings → Logs, the same "a human must be able to see this without
      // reading server stdout" discipline `reminder-sweep-runner.ts` already holds for its own send
      // failures — this is the ONE place with enough context (`companyId`, `transportRef`, the raw
      // response) to make that log useful; `mapChorusProStatus` itself stays a pure, context-free
      // mapper.
      //
      // Fires on the FIRST poll that observes a given unrecognized value for THIS deposit, and again
      // if it later CHANGES to a different still-unrecognized value — never on every identical repeat
      // in between. Measured defect this replaced: logging on literally every poll pass, unconditionally,
      // for as long as the authority kept answering with the same unrecognized status — a poller
      // retried every 60s over a multi-day give-up window could write on the order of ten thousand
      // near-identical `Log` rows (full `raw` response included) for ONE deposit before ever giving up.
      // A genuinely NEW status (this deposit's first sighting, or a change from one unrecognized value
      // to another) still surfaces immediately — nothing here waits for `mapChorusProStatus` to be
      // fixed before speaking up again. Never awaited into a failure of the poll itself —
      // `LoggerService` already never throws (catches its own write failures internally), so this is
      // belt-and-suspenders, not a new failure mode.
      if (mapped === 'UNKNOWN' && lastLoggedUnknownStatus.get(transportRef) !== cr.statutFlux) {
        lastLoggedUnknownStatus.set(transportRef, cr.statutFlux);
        await logger.error(
          `Chorus Pro returned an unrecognized flux status "${cr.statutFlux}" for deposit ` +
            `${transportRef} — mapChorusProStatus has no branch for it yet, so it reads as UNKNOWN ` +
            "(never terminal, but never silently PENDING either — see that function's own doc " +
            'comment).',
          {
            category: 'documents',
            details: {
              companyId,
              providerId: CHORUS_PRO_PROVIDER_ID,
              transportRef,
              statutFlux: cr.statutFlux,
              raw: cr.raw,
            },
          },
        );
      }

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
