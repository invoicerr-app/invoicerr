/**
 * The SECOND `AuthorityStatusPoller` — Poland's KSeF, GATED (never claimed proven live — see the
 * honesty note below). `transports/ksef/ksef-client.ts` DOES carry a usable status method —
 * `invoiceStatus(sessionRef, invoiceRef, accessToken)` (`GET /sessions/{sRef}/invoices/{iRef}`,
 * `InvoiceStatusResponse` — see that file's own header, "Status flow: ... GET .../invoices/{iRef} →
 * invoice status + ksefNumber") — so this is that endpoint, wired, never an invented one.
 *
 * ## HONESTY NOTE — what is, and is NOT, verified here
 *
 * `KSEF_AUTH_TOKEN` is absent from every environment available in this checkout (see
 * `transports/ksef/ksef.live.spec.ts`'s own header — `send()` itself was only ever proven live
 * historically, not re-proven alongside this poller). Two consequences, both real:
 *
 *  1. The status-code mapping below (`isTerminal`, `mapKsefEvent`) is NOT independently live-verified
 *     for THIS endpoint. It reuses the ONE convention this exact codebase already trusts for the
 *     IDENTICAL `{ code, description, details }` shape — `ksef-transport.ts`'s own `authenticate()`
 *     treats `status.code === 200` as success and `status.code >= 400` as rejection for the AUTH
 *     status endpoint (`AuthStatusResponse`). `InvoiceStatusResponse.status` is typed with the exact
 *     same shape (`ksef-client.ts`), so applying the same reading here is a principled reuse of an
 *     already-relied-upon convention, not a fabrication — but it is still an EXTRAPOLATION across two
 *     different endpoints, not a value KSeF was actually observed to return.
 *  2. Whether `invoiceStatus` still answers ONCE THE SESSION IS CLOSED is UNKNOWN: `ksef-transport.ts`
 *     closes the online session immediately after sending (`closeSession`, right after
 *     `sendInvoice`), and this codebase has never observed, live, whether a closed session's own
 *     invoice status remains queryable afterwards. This poller calls the endpoint regardless — if
 *     KSeF answers 4xx/404 for a closed session, THAT response is itself journaled as `poll:blocked`
 *     (an ordinary thrown error, caught by `conformity-sweep-runner.ts`'s own `runPoll` — never a
 *     crash), which is at least an honest, visible signal rather than a silent gap, but it is NOT the
 *     same thing as a proven, working poll. Recorded here — not glossed
 *     over.
 *
 * `ksef-status-poller.live.spec.ts` is gated `KSEF_LIVE=1` (`KSEF_AUTH_TOKEN` required) and SKIPS
 * cleanly today, saying so on stderr — it does not invent a sandbox or a fabricated token to force a
 * green run.
 *
 * ## Mutualized handshake — one access token per (company, environment), not one per document
 *
 * The FIRST version of this poller called `authenticate()` fresh on every `poll()` — meaning a
 * `runSweep` pass with N pending PL documents for the SAME company fired N full handshakes
 * (`authChallenge` + `authKsefToken` + up to `AUTH_POLL_ATTEMPTS` `authStatus` polls +
 * **`authRedeem`, which mints a brand-new, never-revoked access/refresh token pair every single
 * time**) once per minute, against a quota this sweep itself controls the pace of. That is the poller
 * rate-limiting ITSELF: a company with even a handful of documents awaiting a verdict could exhaust
 * KSeF's own auth quota well before any of them ever see a terminal status, and keep failing every
 * poll (`poll:blocked`) until `poll:gave-up` at the max poll age. `accessTokenCache` below fixes this
 * the same way `transports/pdp/pdp-client.ts`'s own `PdpClient.token` already does for PDP: cache the
 * token in memory, keyed by `${companyId}:${environment}:${credentialFingerprint}` (never companyId
 * alone, and never `${companyId}:${environment}` alone — a company can hold
 * BOTH TEST and PROD KSeF credentials over its lifetime, and a TEST token must never reach the PROD
 * API or vice versa), reused by every poll while it stays valid rather than re-minted for each one.
 * The fingerprint is what turns a credential ROTATION on that same (company, environment) slot — the
 * company re-entered a new KSeF token in company settings, `upsertChannelConfig` overwrote the row in
 * place — into an automatic cache MISS: without it, this cache would keep answering polls with an
 * access token minted under the credential that was just REPLACED, for as long as that token's own
 * TTL allows, silently outliving the very rotation meant to end its use.
 */
import { createHash } from 'node:crypto';

import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import { authenticate, extractKsefCredentials, KsefCredentials } from '../../transports/ksef-transport';
import { FetchKsefHttpClient } from '../../transports/ksef/fetch-http-client';
import { InvoiceStatusResponse, KsefClient } from '../../transports/ksef/ksef-client';
import { loadVendorizedKeys } from '../../transports/ksef/ksef-public-keys';
import {
  AuthorityStatusPoller,
  ChannelNotConnectedError,
  RawAuthorityEvent,
} from '../authority-status-poller';

export const KSEF_PROVIDER_ID = 'ksef';

/** Refreshed this far ahead of the cached token's own `expiresAt` — the identical 60s safety margin
 *  `transports/pdp/pdp-client.ts`'s own token cache already applies, so a token technically still
 *  valid by KSeF's clock is never handed to a poll that might cross the expiry boundary mid-flight. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Module-level, not per-poller-instance: `buildKsefStatusPoller` is called exactly ONCE at boot to
 *  build the singleton this provider registers in `AuthorityStatusPollerRegistry`, so a closure-scoped
 *  cache would already live exactly as long as the process does — a module-level `Map` is simply the
 *  more conventional way to spell that same lifetime, and keeps the cache reachable from
 *  `__resetKsefAccessTokenCacheForTests` below without threading it through `KsefStatusPollerDeps`. */
const accessTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/** Test-only escape hatch — every `buildKsefStatusPoller({...})` call in a fresh `describe` block must
 *  start from an empty cache, or an EARLIER test's cached token would silently make a LATER test's own
 *  "does it re-authenticate" assertion pass for the wrong reason. Not exported outside this module's
 *  own spec file's needs beyond this. */
export function __resetKsefAccessTokenCacheForTests(): void {
  accessTokenCache.clear();
}

/** Ties the cache key to the CONTENT of the credentials, not merely their (company, environment)
 *  slot — a plain digest of the KSeF token itself (the one secret that actually changes when a
 *  company rotates its credentials; `nip` rarely if ever does, and is already folded into the key via
 *  `environment`'s own scoping). Truncated: this is a cache key, never a security boundary of its own
 *  (the real secret stays in `credentials.ksefToken`, never logged or persisted here) — enough bits to
 *  make an accidental collision between two DIFFERENT tokens for the same (company, environment)
 *  astronomically unlikely, no more. */
function credentialFingerprint(credentials: KsefCredentials): string {
  return createHash('sha256').update(credentials.ksefToken).digest('hex').slice(0, 16);
}

/** One access token per `(companyId, environment, credentialFingerprint)`, reused for every poll
 *  while it stays valid — see this file's own header, "Mutualized handshake". Evicted eagerly
 *  whenever using it fails (a 401 the cached token no longer satisfies, a network error mid-call): the
 *  NEXT poll re-authenticates fresh rather than retrying the exact same bad value until it happens to
 *  expire on its own — the identical discipline `transports/pdp/pdp-client.ts`'s own 401-triggered
 *  `clearToken()` already holds. Also evicted IMPLICITLY the moment credentials are rotated: the
 *  fingerprint changes, so the OLD cache entry (still keyed under the OLD fingerprint) is simply never
 *  looked up again — see this file's own header for why that self-invalidation matters here. */
async function getSharedAccessToken(
  client: KsefClient,
  companyId: string,
  credentials: KsefCredentials,
): Promise<string> {
  const cacheKey = `${companyId}:${credentials.environment}:${credentialFingerprint(credentials)}`;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }

  const fresh = await authenticate(client);
  accessTokenCache.set(cacheKey, fresh);
  return fresh.accessToken;
}

/** See this file's own header (§1) for why this mirrors `ksef-transport.ts#authenticate`'s own
 *  `{ code, description, details }` reading rather than a KSeF-invoice-status-specific convention
 *  this codebase has never actually observed. */
function isTerminalKsefCode(statusCode: string): boolean {
  const match = /^pl:(\d+)$/.exec(statusCode);
  if (!match) return false;
  const code = Number(match[1]);
  return code === 200 || code >= 400;
}

function mapKsefStatus(response: InvoiceStatusResponse): RawAuthorityEvent {
  const code = response.status.code;
  const rejected = code >= 400;
  return {
    statusCode: `pl:${code}`,
    statusText: response.status.description,
    reason: rejected
      ? [response.status.description, ...(response.status.details ?? [])].filter(Boolean).join('; ')
      : undefined,
    // KSeF's own `InvoiceStatusResponse` carries no "when did this status itself change" field (only
    // `acquisitionDate`/`permanentStorageDate`, both about the INVOICE's own lifecycle milestones,
    // not this particular status read) — "now" is the only honest value for "when THIS poll observed
    // it", the same fallback `pdp-status-poller.ts` uses for a PDP event missing `created_at`.
    observedAt: new Date(),
    rawPayload: response,
  };
}

export interface KsefStatusPollerDeps {
  channelCredentials: ChannelCredentialsService;
}

/** `${sessionRef}|${invoiceRef}` — the exact shape `ksef-transport.ts#send()` builds `reference`
 *  from. Throws a plain `Error` (never `ChannelNotConnectedError` — a malformed reference is not a
 *  credentials problem) for a `transportRef` that doesn't split into exactly two non-empty parts;
 *  `conformity-sweep-runner.ts#runPoll` still catches it and journals `poll:blocked`, never crashing. */
function parseKsefTransportRef(transportRef: string): { sessionRef: string; invoiceRef: string } {
  const parts = transportRef.split('|');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Malformed KSeF transportRef (expected "sessionRef|invoiceRef"): "${transportRef}"`);
  }
  return { sessionRef: parts[0], invoiceRef: parts[1] };
}

async function resolveKsefCredentials(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<KsefCredentials> {
  const resolved: ResolvedChannelConfig | null = await channelCredentials.resolveActive(
    companyId,
    KSEF_PROVIDER_ID,
  );
  const credentials = resolved && extractKsefCredentials(resolved);
  if (!credentials) throw new ChannelNotConnectedError(KSEF_PROVIDER_ID);
  return credentials;
}

export function buildKsefStatusPoller(deps: KsefStatusPollerDeps): AuthorityStatusPoller {
  return {
    providerId: KSEF_PROVIDER_ID,
    isTerminal: isTerminalKsefCode,

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const { sessionRef, invoiceRef } = parseKsefTransportRef(transportRef);
      const credentials = await resolveKsefCredentials(deps.channelCredentials, companyId);

      const keys = loadVendorizedKeys(credentials.environment);
      const http = new FetchKsefHttpClient();
      const client = new KsefClient(http, {
        environment: credentials.environment,
        nip: credentials.nip,
        ksefToken: credentials.ksefToken,
        tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
        symmetricKeyPem: keys.symmetricKeyPem,
      });

      // Shared across every poll for this (company, environment, credential) triple while it stays
      // valid — see this file's own header, "Mutualized handshake". Whatever token `send()` used at
      // deposit time is long gone by the time a later sweep pass polls (that one was never cached to
      // begin with), so this still authenticates on the FIRST poll for a given triple; only the
      // REPEATED handshake per document, per pass, is what this cache removes.
      const cacheKey = `${companyId}:${credentials.environment}:${credentialFingerprint(credentials)}`;
      const accessToken = await getSharedAccessToken(client, companyId, credentials);
      try {
        const status = await client.invoiceStatus(sessionRef, invoiceRef, accessToken);
        return [mapKsefStatus(status)];
      } catch (error) {
        // The cached token could be the reason this call failed (revoked/expired server-side before
        // our own `expiresAt` margin says it should be) — evicted so the NEXT poll re-authenticates
        // fresh rather than retrying this exact same value until it happens to expire on its own.
        accessTokenCache.delete(cacheKey);
        throw error;
      }
    },
  };
}
