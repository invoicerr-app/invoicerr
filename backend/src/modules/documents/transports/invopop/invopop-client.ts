/**
 * HTTP client for the Invopop platform API (`api.invopop.com`) - the transmission platform behind
 * `transports/invopop-transport.ts`. Dependency-free (bare `fetch`), the same shape
 * `pdp/pdp-client.ts` already holds for superpdp, so nothing here needs a vendor SDK.
 *
 * THE MODEL, in the platform's own words (docs.invopop.com/llms.md, read 2026-09-24): you PUT a GOBL
 * document into the SILO, which wraps it in an envelope and stores it as an ENTRY; you then PUT a JOB
 * that runs a published WORKFLOW over that entry. The workflow's steps (number, sign, convert to the
 * local syntax, hand to the tax authority or network, render a PDF) are what actually transmits.
 * There is no single "deposit this invoice" call: the two writes below ARE the deposit.
 *
 * VERIFIED LIVE 2026-09-24 against the sandbox workspace (see `invopop.live.spec.ts`, and
 * `documentation/docs/developer-guide/live-testing.md` for the captured round trip):
 *
 *  1. NO SEPARATE SANDBOX HOST. `https://api.invopop.com` serves every workspace and the TOKEN
 *     decides which one; `GET /access/v1/workspace` answers `"sandbox": true` or `false`. A base URL
 *     is still a per-company credential here (same as `pdp-client.ts`) rather than a constant, so a
 *     self-hoster can point at a proxy - which is also why the SSRF guard below is not optional.
 *
 *  2. A 403 FROM THIS API IS NOT AN AUTHENTICATION FAILURE. Their edge sits behind Cloudflare, which
 *     answers `403` with a body of `error code: 1010` to any client whose signature it does not like,
 *     valid token or not - their own documentation names Python's `urllib` as one such client and
 *     says to "always send a User-Agent header that names your application". A genuinely missing or
 *     bad token answers `401` with `{"message":"missing authorization token"}` instead. Hence
 *     `INVOPOP_USER_AGENT` below, sent on EVERY request: it is a deliberate compatibility header, not
 *     noise, and removing it would turn a future edge-rule change into an outage that looks exactly
 *     like a credentials problem.
 *
 *  3. THE TOKEN DOES NOT EXPIRE. The workspace API key is a JWT carrying `scope: admin` and `exp: 0`.
 *     There is deliberately NO refresh cycle in this client - unlike `pdp-client.ts`'s OAuth2
 *     `authenticate()`, there is nothing to renew, and inventing a renewal would be inventing a
 *     protocol the platform does not speak.
 *
 *  4. IDEMPOTENCY IS OPT-IN AND WORTH TAKING. `PUT` with a UUID the caller generates is the platform's
 *     own recommended shape; repeating it answers `409 {"key":"conflict","message":"entry already
 *     exists with same id"}` rather than creating a second record. Every `put*` method below treats a
 *     409 as "already created" and re-reads the existing record, which is what makes a BullMQ retry
 *     (`actions/async-send.ts`) safe: a retried send can never deposit the same invoice twice on a
 *     platform that may already have handed it to a tax authority. See `invopop-ids.ts` for how the
 *     two UUIDs are derived deterministically from the document so a retry reuses them.
 *
 * SSRF: `baseUrl` is a company-supplied credential, so every entry point re-validates it through
 * `@/utils/outbound-url` and connects through `pinnedDispatcher(resolved)` - DNS re-resolved on every
 * call, never trusted once at rest. Identical reasoning, and identical deliberate divergences
 * (both schemes, no port restriction), to `pdp/pdp-client.ts`'s own header: read that one for the
 * full argument rather than re-deriving it here.
 */
import {
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
  assertPublicOutboundUrl,
  pinnedDispatcher,
} from '@/utils/outbound-url';

/** Every workspace, sandbox or live, is served from this host - see this file's own header, point 1. */
export const INVOPOP_DEFAULT_BASE_URL = 'https://api.invopop.com';

/** See this file's own header, point 2: Cloudflare, not Invopop, is what this header is for. */
export const INVOPOP_USER_AGENT = 'invoicerr/1.0 (+https://github.com/invoicerr-app/invoicerr)';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface InvopopClientConfig {
  /** API root. Defaults to `INVOPOP_DEFAULT_BASE_URL`; a company may override it. */
  baseUrl?: string;
  /** The workspace API key (a JWT) - sent as `Authorization: Bearer <token>`. */
  apiKey: string;
  timeoutMs?: number;
}

export class InvopopApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'InvopopApiError';
  }
}

export interface InvopopWorkspace {
  id: string;
  name?: string;
  slug?: string;
  country?: string;
  /** TRUE for a test workspace. The ONLY way to tell sandbox from live - see header point 1. */
  sandbox?: boolean;
}

export interface InvopopSiloEntry {
  id: string;
  folder?: string;
  doc_schema?: string;
  /** Set by a workflow's "Sign envelope" (`silo.close`) step; absent until something signs. */
  signed?: boolean;
  /** Present (and `true`) only for an entry stored with `allow_invalid` despite failing validation. */
  invalid?: boolean;
  /** The platform's own summary of the stored document - supplier, customer, totals. */
  snippet?: Record<string, unknown>;
  /** The built GOBL ENVELOPE (`head` + `doc` + `sigs`), not the bare document that was sent. */
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InvopopJobEvent {
  index?: number;
  /** `RUN`, then one of `OK` / `KO` / `SKIP` / `TIMEOUT`. */
  status?: string;
  at?: string;
  code?: string;
  message?: string;
}

export interface InvopopJobIntent {
  id?: string;
  step_id?: string;
  name?: string;
  provider?: string;
  events?: InvopopJobEvent[];
  completed?: boolean;
}

export interface InvopopJobFault {
  provider?: string;
  code?: string;
  message?: string;
}

export interface InvopopJob {
  id: string;
  silo_entry_id?: string;
  workflow_id?: string;
  status?: string;
  /** Set once the job has finished. Absent means it is still running. */
  completed_at?: string;
  intents?: InvopopJobIntent[];
  /**
   * THE authoritative record of failure, and the reason `status` alone is never read as success:
   * the platform's own documentation states that "a job whose step failed and whose error branch then
   * ran reports `status: OK` and still carries `faults`". Absent when nothing failed.
   */
  faults?: InvopopJobFault[];
  envelope?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InvopopJobRequest {
  workflowId: string;
  siloEntryId: string;
  /** Seconds to block waiting for the job to finish (the platform's own `?wait=`). 0 omits it. */
  waitSeconds?: number;
}

interface RawResponse {
  status: number;
  body: unknown;
}

export class InvopopClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: InvopopClientConfig) {
    this.baseUrl = (config.baseUrl || INVOPOP_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Re-checked at the top of every request rather than once at construction - `baseUrl` came from a
   * tenant's own channel configuration and DNS is not a fact fixed at connect time. The thrown
   * message is deliberately generic (the transport folds it into a user-facing error, so naming the
   * reason would turn this guard into a network-scanning oracle). See `pdp/pdp-client.ts`.
   */
  private async resolveBaseUrl(): Promise<ResolvedOutboundUrl | null> {
    try {
      return await assertPublicOutboundUrl(this.baseUrl, {
        allowedProtocols: ['http:', 'https:'],
        allowedPorts: null,
        allowPrivateForTesting: process.env.ALLOW_PRIVATE_OUTBOUND_URLS === '1',
      });
    } catch (err) {
      if (err instanceof OutboundUrlValidationError) {
        throw new InvopopApiError('Invopop baseUrl failed outbound-URL validation.', 0, null, this.baseUrl);
      }
      throw err;
    }
  }

  /**
   * One request. Returns the raw status alongside the parsed body instead of throwing on every
   * non-2xx, because ONE non-2xx is a legitimate outcome the callers below act on rather than
   * propagate: `409 Conflict` means "you already created this", which is a success for an idempotent
   * retry (see this file's own header, point 4). Everything else non-2xx throws.
   */
  private async request(method: string, path: string, body?: unknown): Promise<RawResponse> {
    const resolved = await this.resolveBaseUrl();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      // NEVER remove - see this file's own header, point 2. Without it a Cloudflare edge rule can
      // answer 403 to a perfectly valid token, and the failure reads as a credentials problem.
      'User-Agent': INVOPOP_USER_AGENT,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
      // A validated host can still answer 30x pointing this same request at an internal address;
      // `fetch`'s default would follow it with no further check. Never followed automatically.
      redirect: 'manual',
      dispatcher: pinnedDispatcher(resolved),
    } as RequestInit);

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // A non-JSON body is exactly what the Cloudflare block looks like (`error code: 1010`), so it
        // is kept verbatim rather than swallowed: the message below is the only place that tells an
        // operator they were stopped by the edge and not by the platform.
        parsed = { raw: text.slice(0, 500) };
      }
    }

    if (res.status === 409) return { status: res.status, body: parsed };

    if (!res.ok) {
      throw new InvopopApiError(this.describe(res.status, parsed), res.status, parsed, path);
    }
    return { status: res.status, body: parsed };
  }

  /** Turns a failure body into one line an operator can act on, naming the Cloudflare trap by name. */
  private describe(status: number, body: unknown): string {
    const record = (body ?? {}) as Record<string, unknown>;
    const raw = typeof record.raw === 'string' ? record.raw : '';
    if (status === 403 && raw.includes('1010')) {
      return (
        'Invopop answered 403 from its Cloudflare edge ("error code: 1010"), which is a BLOCKED ' +
        'CLIENT, not a rejected token - a bad token answers 401. Check that the User-Agent header ' +
        'this client sends still reaches the API.'
      );
    }
    const message = typeof record.message === 'string' ? record.message : '';
    const faults = Array.isArray(record.faults)
      ? (record.faults as InvopopJobFault[]).map((f) => `${f.code ?? '?'}: ${f.message ?? ''}`).join('; ')
      : '';
    const detail = [message, faults].filter(Boolean).join(' - ');
    return `Invopop API error ${status}${detail ? `: ${detail}` : ''}`;
  }

  /** `GET /utils/v1/ping` - answers `{"ping":"pong"}`. The cheapest proof a token reaches the API. */
  async ping(): Promise<boolean> {
    const { body } = await this.request('GET', '/utils/v1/ping');
    return (body as { ping?: string } | null)?.ping === 'pong';
  }

  /** `GET /access/v1/workspace` - the ONLY way to tell a sandbox workspace from a live one. */
  async getWorkspace(): Promise<InvopopWorkspace> {
    const { body } = await this.request('GET', '/access/v1/workspace');
    return body as InvopopWorkspace;
  }

  /**
   * `PUT /silo/v1/entries/{id}` with the GOBL document wrapped in `data` - the platform builds,
   * validates and envelopes it. A `409` means this exact id was already stored (a retry): the stored
   * entry is re-read and returned, never a second deposit. A `422` throws, carrying the GOBL fault
   * codes (e.g. `GOBL-FR-TAX-IDENTITY-01`) that name the offending property.
   */
  async putSiloEntry(id: string, document: Record<string, unknown>): Promise<InvopopSiloEntry> {
    const { status, body } = await this.request('PUT', `/silo/v1/entries/${id}`, { data: document });
    if (status === 409) return this.getSiloEntry(id);
    return body as InvopopSiloEntry;
  }

  async getSiloEntry(id: string): Promise<InvopopSiloEntry> {
    const { body } = await this.request('GET', `/silo/v1/entries/${id}`);
    return body as InvopopSiloEntry;
  }

  /**
   * `PUT /transform/v1/jobs/{id}` - runs a PUBLISHED workflow over a stored entry. With `?wait=N` the
   * platform blocks up to N seconds and answers `200` with the finished job; without it (or on
   * timeout) it answers `202` with a stub carrying no `completed_at`. A `409` is the same "already
   * created" case as the entry above and re-reads the existing job.
   */
  async putJob(id: string, request: InvopopJobRequest): Promise<InvopopJob> {
    const wait = request.waitSeconds ?? 0;
    const path = `/transform/v1/jobs/${id}${wait > 0 ? `?wait=${wait}` : ''}`;
    const { status, body } = await this.request('PUT', path, {
      workflow_id: request.workflowId,
      silo_entry_id: request.siloEntryId,
    });
    if (status === 409) return this.getJob(id);
    return body as InvopopJob;
  }

  async getJob(id: string): Promise<InvopopJob> {
    const { body } = await this.request('GET', `/transform/v1/jobs/${id}`);
    return body as InvopopJob;
  }
}
