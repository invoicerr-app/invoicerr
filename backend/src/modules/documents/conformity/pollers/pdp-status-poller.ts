/**
 * The FIRST `AuthorityStatusPoller` — France's PDP. Proven LIVE: a real deposit reaches
 * `fr:202` ("Reçue par la plateforme") within ~1s of upload, past `fr:200` ("Déposée (validée)") and
 * `fr:201` ("Émise par la plateforme"), reproduced five times against the superpdp sandbox (see
 * `pdp/pdp-conformity.live.spec.ts`). A rejection surfaces as `fr:213`, carrying `data.reason` on the
 * event itself — also reproduced live (see that same live spec for how, since a
 * deliberately non-compliant deposit had become hard to produce once the content
 * requirements matured — this file's own poll/journal MECHANICS are proven against the real fr:213
 * payload captured then, not invented).
 *
 * CRITICAL LESSON (`pdp/pdp-client.ts`'s own header): the old
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
 *  the only two codes the live proof ever observed ending a deposit's lifecycle. Every
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

/**
 * `event.created_at` is authority-supplied text, never validated by anything before it reaches here —
 * a MISSING value already fell back to `new Date()` (unchanged below), but an unparseable-yet-PRESENT
 * one used to become `new Date(garbage)`, i.e. `Invalid Date`, and get written straight into
 * `RawAuthorityEvent.observedAt`. `authority-events.persistence.ts#createAuthorityEvents` journals a
 * whole poll pass's events in ONE `createMany` call — a single `Invalid Date` in that array fails the
 * ENTIRE batch at the database, so one bad timestamp could silently swallow every OTHER, genuinely
 * good event observed in the same pass, not merely the one with the bad date. Falling back to "now"
 * for an unparseable value is the same honest degrade `mandate.ts`'s own `isOnOrAfter` already applies
 * to a value it cannot trust — never a hard block, since a bad `created_at` on an otherwise-legitimate
 * platform event is not a reason to stop journaling that event's own status change at all.
 */
function parseEventDate(rawCreatedAt: string | null | undefined): Date {
  if (!rawCreatedAt) return new Date();
  const parsed = new Date(rawCreatedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * `transportRef` is whatever `documents.service.ts` stored as this deposit's PDP-side reference at
 * send time — always a genuine SuperPDP invoice id in practice, but nothing enforces that STATICALLY
 * (it is a bare `string` end to end). `Number(transportRef)` on anything that isn't cleanly numeric
 * (blank, whitespace, a non-numeric external id) silently produces `NaN`, which
 * `PdpClient#getInvoice` would then interpolate straight into the URL
 * (`/v1.beta/invoices/NaN`) — PDP 404s, and the sweep runner's own generic `catch` (
 * `conformity-sweep-runner.ts`) journals that as an ordinary `poll:blocked`, indistinguishable from a
 * transient outage, retried every sweep for as long as this deposit keeps being polled. Refusing HERE,
 * by name, means the `poll:blocked` reason an admin actually reads says "this transportRef is not a
 * valid PDP invoice id" instead of an opaque 404 on a URL containing the literal string "NaN".
 */
function parseInvoiceId(transportRef: string): number {
  // `Number('')` (and `Number('   ')`) is `0`, not `NaN` — trimmed-empty must be rejected explicitly
  // BEFORE the numeric checks below, or a blank transportRef would pass as invoice id 0.
  const trimmed = transportRef.trim();
  const invoiceId = trimmed === '' ? NaN : Number(trimmed);
  if (!Number.isFinite(invoiceId) || !Number.isInteger(invoiceId) || invoiceId < 0) {
    throw new Error(
      `PDP transportRef "${transportRef}" is not a valid PDP invoice id (expected a non-negative ` +
        'integer) — refusing to poll an invoice id that could only ever 404.',
    );
  }
  return invoiceId;
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
      const invoiceId = parseInvoiceId(transportRef);
      const invoice = await client.getInvoice(invoiceId);

      // `events[]` — see this file's own header. An invoice with none yet (a very fresh deposit the
      // platform hasn't even started evaluating) simply yields nothing to journal this pass; the next
      // pass tries again, exactly like a document still waiting for fr:200 always would.
      return (invoice.events ?? []).filter(hasStatusCode).map(
        (event): RawAuthorityEvent => ({
          statusCode: event.status_code,
          statusText: event.status_text,
          reason: event.data?.reason,
          observedAt: parseEventDate(event.created_at),
          rawPayload: event,
        }),
      );
    },
  };
}
