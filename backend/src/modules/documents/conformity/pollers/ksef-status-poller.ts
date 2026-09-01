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
 * `transports/ksef/ksef-live.spec.ts`'s own header — `send()` itself has never been re-proven live
 * THIS session either, only historically, before this task). Two consequences, both real:
 *
 *  1. The status-code mapping below (`isTerminal`, `mapKsefEvent`) is NOT independently live-verified
 *     for THIS endpoint. It reuses the ONE convention this exact codebase already trusts for the
 *     IDENTICAL `{ code, description, details }` shape — `ksef-transport.ts`'s own `authenticate()`
 *     treats `status.code === 200` as success and `status.code >= 400` as rejection for the AUTH
 *     status endpoint (`AuthStatusResponse`). `InvoiceStatusResponse.status` is typed with the exact
 *     same shape (`ksef-client.ts`), so applying the same reading here is a principled reuse of an
 *     already-relied-upon convention, not a fabrication — but it is still an EXTRAPOLATION across two
 *     different endpoints, not a value this session watched KSeF actually return.
 *  2. Whether `invoiceStatus` still answers ONCE THE SESSION IS CLOSED is UNKNOWN: `ksef-transport.ts`
 *     closes the online session immediately after sending (`closeSession`, right after
 *     `sendInvoice`), and this codebase has never observed, live, whether a closed session's own
 *     invoice status remains queryable afterwards. This poller calls the endpoint regardless — if
 *     KSeF answers 4xx/404 for a closed session, THAT response is itself journaled as `poll:blocked`
 *     (an ordinary thrown error, caught by `conformity-sweep-runner.ts`'s own `runPoll` — never a
 *     crash), which is at least an honest, visible signal rather than a silent gap, but it is NOT the
 *     same thing as a proven, working poll. Recorded here, in `TODO_ISSUES.md`, and in this task's
 *     own report — not glossed over.
 *
 * `ksef-status-poller.live.spec.ts` is gated `KSEF_LIVE=1` (`KSEF_AUTH_TOKEN` required) and SKIPS
 * cleanly today, saying so on stderr — it does not invent a sandbox or a fabricated token to force a
 * green run.
 */
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

      // A fresh access token every poll — KSeF's own tokens are short-lived, and whatever token
      // `send()` used at deposit time is long gone by the time a later sweep pass polls. Same
      // handshake `send()` itself uses (`ksef-transport.ts#authenticate`, exported for this reuse).
      const accessToken = await authenticate(client);
      const status = await client.invoiceStatus(sessionRef, invoiceRef, accessToken);
      return [mapKsefStatus(status)];
    },
  };
}
