/**
 * HTTP client for the France PDP API — supports both:
 *   1. SuperPDP proprietary API (v1.beta) — rich lifecycle statuses (fr:200–fr:213)
 *   2. AFNOR Flow Service (XP Z12-013 standard) — portable across PDPs
 *
 * The client is parameterized by `baseUrl` and `apiStyle` so the same code works
 * against any PDP that exposes either API shape.
 *
 * Auth: OAuth2 client_credentials (POST /oauth2/token).
 *
 * Source of truth: OpenAPI specs fetched from superpdp.tech/openapi on 2026-06-28.
 *
 * REPRISED VERBATIM (byte-for-byte, only this header changed) from git tag
 * `avant-refonte-documents` (`compliance/providers/transmission/pdp/pdp-client.ts`): this client is
 * dependency-free (bare `fetch`/`FormData`/`Blob`), so nothing about the document-engine rebuild
 * required touching it. `pdp-transport.ts` only calls `authenticate()` + `sendInvoice()` — the AFNOR
 * Flow / directory / lifecycle-push methods below are kept unused rather than trimmed: another
 * transport (KSeF/SdI reuse the same "one client per jurisdiction" shape) or a PDP polling follow-up
 * can reach for them without a second port of this file.
 *
 * `baseUrl` is a company-supplied credential (`PUT /api/company/channels/pdp`), not a fixed constant —
 * this client is deliberately generic over "any PDP that exposes either API shape" (see the AFNOR
 * paragraph above), so it cannot simply hardcode superpdp's own host. Left unvalidated, a tenant could
 * point it at an internal address and have this SHARED backend dial it on their behalf, presenting
 * that tenant's own OAuth credentials to whatever answered — an authenticated SSRF primitive. Every
 * public entry point below (`authenticate`, `request`, `downloadInvoiceFile`) re-validates `baseUrl`
 * through the shared `@/utils/outbound-url.ts` guard before it ever reaches `fetch`: no private/
 * loopback/link-local target, DNS re-resolved on every single call, never trusted once at rest, since
 * a hostname that resolved public when the channel was connected can be repointed internal by the time
 * an invoice is actually sent ("DNS rebinding").
 *
 * Deliberately NOT the same https-only/port-443-only policy `sso.service.ts` applies to a company's
 * OIDC endpoints: this client's own e2e coverage
 * (`74-received-invoice-inbound.cy.ts`) drives the real reception sweep against a genuine local
 * `node:http` server standing in for the sandbox (`cypress.config.ts#startFakePdpServer`), and
 * `31-national-channels.cy.ts` connects the channel UI against a plain-HTTP closed port — restricting
 * scheme/port here would make both fail on infrastructure this fix has no mandate to rebuild (a real
 * TLS-terminated fake PDP), for a threat (plaintext transport to a LEGITIMATE public PDP) genuinely
 * different from the one this finding is actually about (reaching an INTERNAL host at all), which the
 * private-IP/DNS-rebinding check above already closes regardless of scheme or port. A hard host
 * allowlist (superpdp only) was similarly NOT added: it would contradict this file's own documented
 * "any PDP" design and break a real commercial PDP other than superpdp, which the AFNOR Flow /
 * Directory methods below exist specifically to support.
 *
 * `redirect: 'manual'` on every fetch closes the other half of the same finding — a validated host
 * could still answer with a 30x pointing the SAME request at an internal one, which an auto-followed
 * redirect would silently complete.
 */
import {
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
  assertPublicOutboundUrl,
  pinnedDispatcher,
} from '@/utils/outbound-url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdpClientConfig {
  /** API root, e.g. "https://api.superpdp.tech". */
  baseUrl: string;
  /** OAuth2 client credentials. */
  clientId: string;
  clientSecret: string;
  /** Which API shape to use (default: "superpdp"). */
  apiStyle?: 'superpdp' | 'afnor';
}

export type PdpApiStyle = 'superpdp' | 'afnor';

// --- SuperPDP proprietary types ---

/** One lifecycle event as superpdp actually returns it. */
export interface SuperPdpInvoiceEvent {
  id?: number;
  created_at?: string;
  status_code?: string;
  status_text?: string;
  /** Carries `reason` on a rejection — the only place the conformity failure is explained. */
  data?: { reason?: string; [key: string]: unknown };
}

export interface SuperPdpInvoice {
  id: number;
  direction: 'in' | 'out';
  external_id?: string;
  /**
   * VERIFIED against the live sandbox on 2026-08-29: `GET /v1.beta/invoices/{id}` returns the
   * lifecycle as `events[]`, NOT as a `status_code` array. The flat field is kept optional for
   * older payloads, but reading it alone is why `poll()` answered "no status codes" — and therefore
   * PENDING — for every deposit, which is how "PDP proven live" stayed green while every document
   * was in fact being rejected.
   */
  status_code?: string[];
  events?: SuperPdpInvoiceEvent[];
  created_at: string;
  updated_at: string;
  en_invoice?: Record<string, unknown>;
  validation_report?: { data: unknown[] };
  [key: string]: unknown;
}

export interface SuperPdpInvoiceList {
  data: SuperPdpInvoice[];
  count: number;
  has_before: boolean;
  has_after: boolean;
}

export interface SuperPdpCompany {
  id: number;
  name: string;
  number: string;
  [key: string]: unknown;
}

export interface SuperPdpDirectoryEntry {
  id: number;
  addressing_identifier: string;
  routing_identifier?: string;
  platform_type: 'WK' | 'DFH';
  [key: string]: unknown;
}

// --- AFNOR Flow types ---

export interface AfnorFlowInfo {
  flowId: string;
  submittedAt: string;
  flowSyntax: string;
  flowProfile?: string;
  name: string;
  processingRule?: string;
  trackingId?: string;
  flowDirection: 'In' | 'Out';
  flowType: string;
  acknowledgement?: {
    status: 'Pending' | 'Ok' | 'Error';
    details?: Array<{
      level: 'Error' | 'Warning';
      reasonCode: string;
      reasonMessage: string;
    }>;
  };
  updatedAt: string;
}

export interface AfnorFlowSearchResult {
  results: AfnorFlowInfo[];
  limit: number;
  filters: Record<string, unknown>;
}

// --- Directory types (AFNOR Directory Service) ---

export interface DirectoryLine {
  addressingIdentifier: string;
  siren: string;
  siret?: string;
  routingIdentifier?: string;
  platformType: 'WK' | 'DFH';
  directoryLineStatus: 'Enabled' | 'Disabled' | 'Upcoming';
  [key: string]: unknown;
}

export interface DirectoryLineSearchResult {
  results: DirectoryLine[];
  totalNumberOfResults: number;
}

// --- Error type ---

export class PdpApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly endpoint: string,
  ) {
    super(`PDP ${endpoint}: ${status} — ${message}`);
    this.name = 'PdpApiError';
  }
}

// --- Token type ---

interface TokenState {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export class PdpClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiStyle: PdpApiStyle;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  private token: TokenState | null = null;

  constructor(config: PdpClientConfig, opts?: { timeoutMs?: number; maxRetries?: number }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.apiStyle = config.apiStyle ?? 'superpdp';
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT;
    this.maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * Re-checked at the top of every public entry point (`authenticate`, `request`,
   * `downloadInvoiceFile`), not only once when this client is constructed: `baseUrl` came from a
   * tenant's own channel configuration, and DNS is not a fact fixed at connect time — a hostname that
   * resolved to a public IP then can be repointed at an internal one by the time an invoice is
   * actually sent ("DNS rebinding" — see this file's own header). The message thrown here is
   * deliberately generic: `pdp-transport.ts` folds a caught error's `.message` straight into the
   * `BadRequestException` it returns to the API caller, so leaking WHY (which reason, which address)
   * would turn this guard into a network-scanning oracle for whoever controls the channel config.
   *
   * Returns the `ResolvedOutboundUrl` this check just proved public — every fetch below MUST connect
   * through `pinnedDispatcher(resolved)` rather than letting `fetch` resolve `this.baseUrl`'s hostname
   * a SECOND, independent time: that second resolution is exactly the TOCTOU/DNS-rebinding gap
   * re-validating "immediately before every use" narrows but does not, on its own, close — a
   * short-TTL record can still answer differently the few milliseconds later `fetch` asks again.
   */
  private async resolveBaseUrl(): Promise<ResolvedOutboundUrl | null> {
    try {
      return await assertPublicOutboundUrl(this.baseUrl, {
        // Both schemes, no port restriction — see this file's own header on why this differs from the
        // https-only/port-443 policy `sso.service.ts` applies to a company's OIDC endpoints.
        allowedProtocols: ['http:', 'https:'],
        allowedPorts: null,
        allowPrivateForTesting: process.env.ALLOW_PRIVATE_OUTBOUND_URLS === '1',
      });
    } catch (err) {
      if (err instanceof OutboundUrlValidationError) {
        throw new PdpApiError('PDP baseUrl failed outbound-URL validation.', 0, null, this.baseUrl);
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // OAuth2
  // -----------------------------------------------------------------------

  async authenticate(): Promise<string> {
    const resolved = await this.resolveBaseUrl();

    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.accessToken;
    }

    const url = `${this.baseUrl}/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
      // A validated `baseUrl` could still answer with a 30x pointing this SAME request at an internal
      // address — `fetch`'s own default (`redirect: 'follow'`) would complete that hop with no further
      // check at all. Never followed automatically; a legitimate PDP has no reason to redirect its own
      // OAuth token endpoint.
      redirect: 'manual',
      // Connects to `resolved.address` directly — see `resolveBaseUrl`'s own header on why this, not
      // merely re-validating, is what actually closes the DNS-rebinding window for THIS request.
      dispatcher: pinnedDispatcher(resolved),
    } as RequestInit);

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new PdpApiError(
        `OAuth token error: ${(json as { error_description?: string }).error_description ?? res.statusText}`,
        res.status,
        json,
        'oauth2/token',
      );
    }

    // A 200 with no (or a blank/non-string) `access_token` is a malformed response, not a rare edge
    // case worth papering over: `json.access_token as string` used to cast it unchecked, so a bad
    // response cached `undefined`/`""` here for up to an hour (`expiresIn`'s own default) — every
    // subsequent call would read that SAME unusable value back out of `this.token` below, never
    // re-authenticate, and fail Bearer auth silently until the cache happened to expire. Refusing
    // loudly HERE, before caching anything, turns that into one immediate, diagnosable failure instead.
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    if (!accessToken) {
      throw new PdpApiError(
        'OAuth token response carried no usable access_token — refusing to cache an unusable token.',
        res.status,
        json,
        'oauth2/token',
      );
    }
    const expiresIn = (json.expires_in as number) ?? 3600;
    this.token = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return accessToken;
  }

  /** Force re-authentication (used by poll() — KSeF lesson: no in-memory cache as source of truth —
   *  and by `request()` below, on a 401, so a token invalidated server-side mid-TTL self-heals on the
   *  VERY NEXT call instead of failing every call until this process happens to restart). */
  clearToken(): void {
    this.token = null;
  }

  // -----------------------------------------------------------------------
  // Generic HTTP
  // -----------------------------------------------------------------------

  async request<T>(
    method: string,
    path: string,
    opts?: {
      body?: unknown;
      contentType?: string;
      formData?: FormData;
    },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }

      // Resolved (and pinned) SEPARATELY from whatever `authenticate()` does internally: that call may
      // return a cached token without ever touching the network, and this method's OWN fetch a few
      // lines down needs its own, freshly-checked pin regardless — see `resolveBaseUrl`'s own header.
      const resolved = await this.resolveBaseUrl();
      const token = await this.authenticate();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };

      const fetchOpts: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        // See `authenticate()`'s own comment on its identical option: never follow a redirect
        // automatically, or a validated `baseUrl` could still bounce this request to an internal one.
        redirect: 'manual',
        dispatcher: pinnedDispatcher(resolved),
      } as RequestInit;

      if (opts?.formData) {
        // FormData: let fetch set Content-Type with boundary
        fetchOpts.body = opts.formData;
      } else if (opts?.body !== undefined && method !== 'GET') {
        headers['Content-Type'] = opts.contentType ?? 'application/json';
        fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }

      try {
        const res = await fetch(`${this.baseUrl}${path}`, fetchOpts);
        const ct = res.headers.get('content-type') ?? '';
        let respBody: unknown;
        if (ct.includes('application/json')) {
          respBody = await res.json();
        } else {
          const text = await res.text();
          respBody = text || undefined;
        }

        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = new PdpApiError(`Server error ${res.status}`, res.status, respBody, path);
          continue;
        }

        if (!res.ok) {
          const msg =
            (respBody as { errorMessage?: string })?.errorMessage ??
            (respBody as { error?: string })?.error ??
            (respBody as { message?: string })?.message ??
            res.statusText;
          // A 401 invalidates whatever this instance has cached — see `clearToken()`'s own header:
          // the token could have been revoked/expired server-side before OUR `expiresAt` margin says
          // it should be, and this instance would otherwise keep handing the exact same bad token to
          // every call until the cache happens to expire on its own. This attempt still fails (401 is
          // in the "never retry" 4xx range just below), but the NEXT call re-authenticates instead of
          // repeating it.
          if (res.status === 401) this.clearToken();
          throw new PdpApiError(msg, res.status, respBody, path);
        }

        return respBody as T;
      } catch (err: unknown) {
        if (err instanceof PdpApiError && err.status >= 400 && err.status < 500) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  // -----------------------------------------------------------------------
  // SuperPDP proprietary API
  // -----------------------------------------------------------------------

  /**
   * Send an invoice via the SuperPDP proprietary API.
   * Accepts XML (CII/UBL) or PDF (Factur-X) bytes.
   */
  async sendInvoice(
    content: Buffer | Uint8Array,
    opts?: {
      externalId?: string;
      contentType?: string;
      disablePreCheck?: boolean;
    },
  ): Promise<SuperPdpInvoice> {
    const mime = opts?.contentType ?? guessMime(content);
    const buf = toUint8Array(content);

    // Always use multipart form upload (works for both PDF and XML)
    const form = new FormData();
    const ext = mime.includes('pdf') ? 'pdf' : 'xml';
    form.append('file_name', new Blob([buf], { type: mime }), `invoice.${ext}`);

    const params = new URLSearchParams();
    if (opts?.externalId) params.set('external_id', opts.externalId);
    if (opts?.disablePreCheck) params.set('disable_pre_check', 'true');
    const qs = params.toString() ? `?${params}` : '';

    return this.request<SuperPdpInvoice>('POST', `/v1.beta/invoices${qs}`, {
      formData: form,
    });
  }

  async getInvoice(
    id: number,
    format?: 'en16931' | 'original' | 'cii' | 'ubl' | 'factur-x',
  ): Promise<SuperPdpInvoice> {
    const params = format ? `?format=${format}` : '';
    return this.request<SuperPdpInvoice>('GET', `/v1.beta/invoices/${id}${params}`);
  }

  /**
   * Raw file bytes for one deposit — never JSON-parsed, unlike every other method on this class:
   * `request<T>()` only ever branches on `content-type` between `res.json()` and `res.text()` (see
   * that method's own body above), and `res.text()` decodes as UTF-8, which silently corrupts a
   * binary PDF the moment a byte sequence isn't valid UTF-8. Added for RECEPTION (a poller downloading
   * an INBOUND deposit's own original/Factur-X artifact to attach to a `received-invoice` — see
   * `pdp-reception.ts`): `sendInvoice()`/`getInvoice()` above never needed this because outbound
   * `send()` already holds the bytes it uploaded, in memory, before ever calling superpdp.
   *
   * `format` mirrors `getInvoice`'s own enum (`?format=` query param), same endpoint
   * (`GET /v1.beta/invoices/{id}`), the ONE difference being how the response body is read. LIVE
   * VERIFIED, 2026-09-16 (see `pdp-reception.live.spec.ts`): there is NO separate `/file`
   * sub-resource — an earlier version of this method guessed one and got a real, live 404 against the
   * sandbox for every deposit tried (fresh and old alike). `GET /v1.beta/invoices/{id}?format=original`
   * is the SAME endpoint `getInvoice()` already calls, except the sandbox answers it with
   * `content-type: application/pdf` (real PDF magic bytes confirmed live) rather than JSON — so
   * `getInvoice()` itself would silently corrupt this exact same response via `request<T>()`'s own
   * `res.text()` fallback (UTF-8-decoding binary bytes) if ever called with `format: 'original'`; this
   * method exists specifically to read the SAME response as `arrayBuffer()` instead. `'original'` (the
   * exact bytes as received, PDF or XML depending on what the sender actually deposited) is the
   * default: the reception poller attaches THAT, never a re-derived EN16931/CII view of it, so the
   * received-invoice record's own downloadable file is byte-identical to what superpdp itself received.
   */
  async downloadInvoiceFile(
    id: number,
    format: 'original' | 'en16931' | 'cii' | 'ubl' | 'factur-x' = 'original',
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const resolved = await this.resolveBaseUrl(); // own, fresh pin — see `request()`'s identical comment
    const token = await this.authenticate();
    const path = `/v1.beta/invoices/${id}?format=${format}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
      // See `authenticate()`'s own comment on its identical option.
      redirect: 'manual',
      dispatcher: pinnedDispatcher(resolved),
    } as RequestInit);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    if (!res.ok) {
      // Same error-shaping discipline as `request<T>()` above — a JSON error body is read as JSON,
      // anything else as text, so a failed download surfaces the platform's own explanation rather
      // than a bare status code.
      const isJson = contentType.includes('application/json');
      const body = isJson ? await res.json() : await res.text();
      const msg = isJson
        ? ((body as { errorMessage?: string; error?: string; message?: string }).errorMessage ??
          (body as { error?: string }).error ??
          (body as { message?: string }).message ??
          res.statusText)
        : res.statusText;
      throw new PdpApiError(msg, res.status, body, path);
    }
    const arrayBuffer = await res.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), contentType };
  }

  async listInvoices(opts?: {
    direction?: 'in' | 'out';
    date?: string;
    limit?: number;
    startingAfterId?: number;
  }): Promise<SuperPdpInvoiceList> {
    const params = new URLSearchParams();
    if (opts?.direction) params.set('direction', opts.direction);
    if (opts?.date) params.set('date', opts.date);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.startingAfterId) params.set('starting_after_id', String(opts.startingAfterId));
    const qs = params.toString() ? `?${params}` : '';
    return this.request<SuperPdpInvoiceList>('GET', `/v1.beta/invoices${qs}`);
  }

  async getCompany(): Promise<SuperPdpCompany> {
    return this.request<SuperPdpCompany>('GET', '/v1.beta/companies/me');
  }

  // -----------------------------------------------------------------------
  // SuperPDP French Directory (annuaire routing)
  // -----------------------------------------------------------------------

  async lookupDirectoryEntries(siren: string): Promise<SuperPdpDirectoryEntry[]> {
    const res = await this.request<{ data: SuperPdpDirectoryEntry[] }>(
      'GET',
      `/v1.beta/french_directory/entries?number=${encodeURIComponent(siren)}`,
    );
    return res.data ?? [];
  }

  // -----------------------------------------------------------------------
  // AFNOR Flow Service (XP Z12-013 standard)
  // -----------------------------------------------------------------------

  /**
   * Submit a flow via the AFNOR Flow API (POST /v1/flows).
   * `file` is the raw invoice bytes (PDF or XML).
   * `flowInfo` qualifies the flow (syntax, profile, processing rule, tracking id).
   */
  async submitFlow(
    file: Buffer | Uint8Array,
    flowInfo: {
      flowSyntax: 'CII' | 'UBL' | 'Factur-X' | 'CDAR' | 'FRR';
      flowProfile?: 'Basic' | 'CIUS' | 'Extended-CTC-FR';
      name: string;
      processingRule?: string;
      trackingId?: string;
    },
  ): Promise<AfnorFlowInfo> {
    const buf = toUint8Array(file);
    const form = new FormData();
    const ext = flowInfo.flowSyntax === 'Factur-X' ? 'pdf' : 'xml';
    const mime = ext === 'pdf' ? 'application/pdf' : 'application/xml';
    form.append('file', new Blob([buf], { type: mime }), `${flowInfo.name}.${ext}`);
    // Only emit optional args when explicitly set: superpdp's AFNOR Flux sandbox returns
    // `501 — processingRule are not yet supported as argument` if processingRule is present.
    const flowInfoPayload: Record<string, unknown> = {
      flowSyntax: flowInfo.flowSyntax,
      flowProfile: flowInfo.flowProfile ?? 'Extended-CTC-FR',
      name: flowInfo.name,
    };
    if (flowInfo.processingRule !== undefined) flowInfoPayload.processingRule = flowInfo.processingRule;
    if (flowInfo.trackingId !== undefined) flowInfoPayload.trackingId = flowInfo.trackingId;
    form.append('flowInfo', new Blob([JSON.stringify(flowInfoPayload)], { type: 'application/json' }));

    return this.request<AfnorFlowInfo>('POST', '/afnor-flow/v1/flows', {
      formData: form,
    });
  }

  async searchFlows(
    filters: {
      flowType?: string;
      flowDirection?: 'In' | 'Out';
      trackingId?: string;
      ackStatus?: 'Pending' | 'Ok' | 'Error';
      updatedAfter?: string;
    },
    limit = 10,
  ): Promise<AfnorFlowSearchResult> {
    return this.request<AfnorFlowSearchResult>('POST', '/afnor-flow/v1/flows/search', {
      body: { where: filters, limit },
    });
  }

  async getFlow(flowId: string): Promise<AfnorFlowInfo> {
    return this.request<AfnorFlowInfo>('GET', `/afnor-flow/v1/flows/${encodeURIComponent(flowId)}`);
  }

  // -----------------------------------------------------------------------
  // Lifecycle status push (a party notifying the PDP of a status change — outbound seller codes like
  // fr:211/fr:212, or BUYER-side codes like fr:203/fr:205 pushed from the RECEPTION side — see
  // `pdp-reception.ts`'s own header for the received-invoice "approve"/"reject"/"paid" actions)
  // -----------------------------------------------------------------------

  /**
   * Push a lifecycle status event to the PDP for a deposited invoice.
   *
   * SuperPDP proprietary endpoint (as documented, never independently confirmed until now):
   * POST /v1.beta/invoices/{id}/lifecycle_events, body `{ code: "fr:211" }` (XP Z12-012 lifecycle
   * code, e.g. fr:211 = payment sent, fr:212 = payment received, fr:205 = accepted by buyer).
   *
   * LIVE PROOF, 2026-09-16 (`pdp-reception.live.spec.ts`): this endpoint answers a real, generic
   * `404 {"http_status_code":404}` on the current superpdp sandbox — tried against a freshly deposited
   * invoice (both its "out" id AND its "in" twin, see `pdp-reception.ts`'s own header on why a
   * self-addressed deposit yields two distinct ids), and against every plausible path variant
   * (`lifecycle-events`, `/events`, `/status`, `/statuses`, `/lifecycle`, a plain `PUT` on the invoice
   * itself) — all 404, the identical shape a genuinely unregistered route returns (compare
   * `authenticate()`'s own 4xx/5xx error shaping: a validation failure on a REAL route answers 400/422
   * with a specific message, not this generic body). Conclusion, not a guess: the sandbox's "API Flux"
   * does not expose ANY lifecycle-status-push route today, under any of the names this codebase or the
   * XP Z12-012 naming convention suggested. This method is kept (never deleted) — a real production PA
   * may still implement it, and `pdp-reception.ts`'s own status-push calls degrade to a LOGGED, non-fatal
   * no-op on a 404 specifically, never a crashed poll — see `documentation/docs/developer-guide/
   * live-testing.md`'s own PDP reception section for the full evidence and what remains unverified.
   */
  async pushLifecycleStatus(invoiceId: number, code: string): Promise<void> {
    await this.request<unknown>('POST', `/v1.beta/invoices/${invoiceId}/lifecycle_events`, {
      body: { code },
    });
  }

  // -----------------------------------------------------------------------
  // AFNOR Directory Service (XP Z12-013 standard)
  // -----------------------------------------------------------------------

  async searchDirectoryLines(
    filters: {
      siret?: string;
      siren?: string;
      addressingIdentifier?: string;
    },
    limit = 10,
  ): Promise<DirectoryLineSearchResult> {
    return this.request<DirectoryLineSearchResult>('POST', '/afnor-directory/v1/directory-line/search', {
      body: {
        filters: Object.fromEntries(
          Object.entries(filters)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, { op: 'strict', value: v }]),
        ),
        limit,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  getApiStyle(): PdpApiStyle {
    return this.apiStyle;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessMime(content: Buffer | Uint8Array): string {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  // PDF magic: %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf';
  }
  // XML: starts with < (possibly with BOM or whitespace)
  if (bytes[0] === 0x3c || bytes[0] === 0xef /* UTF-8 BOM */ || bytes[0] === 0xff /* UTF-16 BE BOM */) {
    return 'application/xml';
  }
  return 'application/xml';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUint8Array(data: Buffer | Uint8Array): Uint8Array<ArrayBuffer> {
  // Copy into a fresh ArrayBuffer to guarantee ArrayBuffer (not SharedArrayBuffer)
  const src = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, srcByteOffset(data), srcByteLength(data));
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  return new Uint8Array(ab);
}

function srcByteOffset(d: Uint8Array): number {
  return d.byteOffset;
}

function srcByteLength(d: Uint8Array): number {
  return d.byteLength;
}
