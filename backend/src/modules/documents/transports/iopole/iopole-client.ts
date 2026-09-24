/**
 * HTTP client for the Iopole API - the French, DGFiP-registered transmission platform
 * (`iopole.com`), sandbox at `api.ppd.iopole.fr`, production at `api.iopole.com`.
 *
 * Source of truth: the platform's OWN OpenAPI document, fetched from the SANDBOX host on 2026-09-24
 * (`GET https://api.ppd.iopole.fr/v1/api/operator/invoicing`, "Invoicing operator Iopole API 1.0.0").
 * Not the prose documentation, which is a client-rendered page and, on the three points below,
 * disagrees with what the platform actually does.
 *
 * Shape, same split every sibling client in this directory holds (`pdp/pdp-client.ts`,
 * `chorus-pro/choruspro-client.ts`): this file speaks the platform's wire protocol and nothing else;
 * resolving a company's credentials, building the payload and enforcing the hard-success contract is
 * `transports/iopole-transport.ts`'s job. Dependency-free (bare `fetch`/`FormData`/`Blob`), the same
 * choice `pdp-client.ts` documents for itself.
 *
 * THREE THINGS THE DOCUMENTATION DOES NOT SAY, each verified live against the sandbox on 2026-09-24
 * and each one a bug waiting to happen if "fixed" back to what the documentation claims:
 *
 *  1. `client_id` IS THE ACCOUNT'S E-MAIL ADDRESS. Unusual for OAuth2, but that is genuinely what
 *     Iopole issues: the delivered token's own `client_id` claim carries the e-mail back verbatim,
 *     and its `preferred_username` is `service-account-<that same e-mail>`. Nothing here may
 *     normalise, split or "correct" that field.
 *
 *  2. THE TOKEN LASTS 1740 SECONDS, NOT THE 3600 THE DOCUMENTATION CLAIMS. Measured: the token
 *     endpoint answers `expires_in: 1740` (29 minutes). This client therefore derives its expiry
 *     from the RESPONSE ALONE and never from a compiled-in default - see `authenticate()`'s own
 *     comment on why a missing/unusable `expires_in` expires the token IMMEDIATELY rather than
 *     falling back to an hour. Hardcoding 3600 would hand a dead token to every call for the eleven
 *     minutes between the real expiry and the assumed one, and the symptom (a 401 on an unrelated
 *     call, intermittently) names nothing about the cause.
 *
 *  3. `customer-id` IS REQUIRED ON EVERY CALL, not only at authentication. The OpenAPI document
 *     marks the header `required: false` on every operation, which is wrong in practice for an
 *     operator account: without it the platform cannot tell which of its customers the call is for.
 *     This client sends it on EVERY request, unconditionally, and refuses to be constructed without
 *     one - see `IopoleClientConfig.customerId`. Do not confuse it with the sandbox SCOPE that
 *     appears in the token's own `scope` claim (`iopole_<8 chars>`): the two look alike and are
 *     different values, and swapping them fails late, on a call that will not say why.
 *
 * SSRF: unlike `pdp-client.ts`, this client's hosts are NOT a company-supplied credential. They are
 * fixed per environment in `iopole-transport.ts#IOPOLE_URLS` (the same convention
 * `chorus-pro-transport.ts#CHORUS_PRO_URLS` and `ksef-transport.ts#BASE_URLS` already hold), so a
 * tenant cannot repoint this client at an internal address and there is no authenticated SSRF
 * primitive to close here. `redirect: 'manual'` is still set on every fetch: a platform host that
 * answered with a 30x would otherwise have this client replay the SAME request, Bearer token and
 * `customer-id` header included, at whatever the redirect named, and a legitimate API has no reason
 * to redirect these paths.
 *
 * A FOURTH gap, found by running the round trip rather than by reading anything: `GET /v1/invoice/{id}`
 * answers with an ARRAY of one metadata object where the OpenAPI document declares a single object.
 * See `getInvoice()`'s own comment.
 */

/** Everything this client needs to talk to one Iopole account. `apiBaseUrl`/`tokenUrl` are fixed per
 *  environment by the transport, never company-supplied - see this file's own header on SSRF. */
export interface IopoleClientConfig {
  /** API root, e.g. "https://api.ppd.iopole.fr" - no trailing slash required, one is stripped. */
  apiBaseUrl: string;
  /** Full OAuth2 token endpoint. A DIFFERENT host from `apiBaseUrl` on both environments (Keycloak:
   *  `auth.ppd.iopole.fr` / `auth.iopole.com`), which is why this is a whole URL and not a path. */
  tokenUrl: string;
  /** The account's e-mail address - see this file's own header, point 1. */
  clientId: string;
  clientSecret: string;
  /** Sent as the `customer-id` header on every request - see this file's own header, point 3. */
  customerId: string;
}

/** What `POST /v1/invoice` answers with on 201 - `{ type, id }`, per the platform's own OpenAPI
 *  document and confirmed live. `id` is the Iopole invoice uuid, the only handle anything later
 *  (status history, file download, the conformity poller a follow-up will add) can be looked up by. */
export interface IopoleCreatedElement {
  type: string;
  id: string;
}

/** One entry of `GET /v1/invoice/{invoiceId}/status-history`. `status.code` is the platform's own
 *  lifecycle vocabulary (SUBMITTED / ISSUED / RECEIVED / ... / REJECTED / UNACCEPTABLE) - the full
 *  enum lives in the OpenAPI document; this type deliberately keeps it a plain `string` so a code
 *  Iopole adds later reaches a caller intact instead of being silently dropped. */
export interface IopoleInvoiceStatus {
  statusId?: string;
  date?: string;
  destType?: string;
  invoiceId?: string;
  status?: { code?: string; networkCode?: string };
  [key: string]: unknown;
}

/** Invoice metadata as `GET /v1/invoice/{invoiceId}` returns it. Open-ended for the same reason
 *  `IopoleInvoiceStatus` is. */
export interface IopoleInvoiceMetadata {
  invoiceId?: string;
  streamId?: string;
  date?: string;
  originalFormat?: string;
  originalFlavor?: string;
  originalNetwork?: string;
  way?: string;
  [key: string]: unknown;
}

export class IopoleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly endpoint: string,
  ) {
    super(`Iopole ${endpoint}: ${status} - ${message}`);
    this.name = 'IopoleApiError';
  }
}

interface TokenState {
  accessToken: string;
  /** Epoch ms, already reduced by `TOKEN_SAFETY_MARGIN_MS` - see `authenticate()`. */
  expiresAt: number;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * How early this client stops trusting a token it still holds. 60s against a 1740s token (see this
 * file's own header, point 2) is ~3.4% of its life - ample for one in-flight request plus the
 * platform's own clock skew, and small enough that a token is not re-fetched on every call.
 */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The platform validates the UPLOADED FILE'S OWN NAME, not only its bytes: the OpenAPI document
 * constrains the multipart `file` part with `pattern: ^.*.(pdf|PDF|xml|XML|Pdf|Xml)$`. A deposit
 * whose filename carries any other extension is refused before the content is ever looked at, which
 * is a confusing failure to debug from the platform's own message. Derived from the MIME the
 * transport already knows, never guessed from the bytes.
 */
export function iopoleFileExtensionFor(mime: string): 'pdf' | 'xml' {
  return mime.includes('pdf') ? 'pdf' : 'xml';
}

/**
 * Copies into a fresh `ArrayBuffer` so the result is a `Uint8Array<ArrayBuffer>`, which is what
 * `BlobPart` accepts - a plain `Uint8Array` is typed over `ArrayBufferLike`, which TypeScript will
 * not narrow for `new Blob([...])` because it could be a `SharedArrayBuffer`. The same copy
 * `pdp/pdp-client.ts#toUint8Array` makes, for the same reason.
 */
function toBlobBytes(data: Buffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Uint8Array(buffer);
}

export class IopoleClient {
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly customerId: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  private token: TokenState | null = null;

  constructor(config: IopoleClientConfig, opts?: { timeoutMs?: number; maxRetries?: number }) {
    if (!config.customerId) {
      // Refused HERE rather than on the first call: `customer-id` is mandatory on every Iopole
      // request (see this file's own header, point 3), so a client built without one can do nothing
      // at all, and failing at construction names the cause instead of leaving a 401/403 to be
      // misread as a credential problem.
      throw new Error('IopoleClient requires a customerId - it is mandatory on every Iopole API call.');
    }
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
    this.tokenUrl = config.tokenUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.customerId = config.customerId;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT;
    this.maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * OAuth2 client_credentials against the platform's Keycloak realm. Returns a cached token while it
   * is still comfortably valid, otherwise fetches a fresh one.
   */
  async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
      // See this file's own header on SSRF: never follow a redirect on a request that carries this
      // account's own client secret.
      redirect: 'manual',
    });

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new IopoleApiError(
        `OAuth token endpoint answered ${res.status} with a body that is not JSON.`,
        res.status,
        null,
        'oauth2/token',
      );
    }

    if (!res.ok) {
      const description =
        (json as { error_description?: string }).error_description ??
        (json as { error?: string }).error ??
        res.statusText;
      throw new IopoleApiError(`OAuth token error: ${description}`, res.status, json, 'oauth2/token');
    }

    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    if (!accessToken) {
      // Same refusal `pdp-client.ts#authenticate` documents for the identical case: caching an
      // empty/undefined token would make every later call fail Bearer auth silently until the cache
      // happened to expire, with nothing pointing at this response.
      throw new IopoleApiError(
        'OAuth token response carried no usable access_token - refusing to cache an unusable token.',
        res.status,
        json,
        'oauth2/token',
      );
    }

    // THE EXPIRY IS READ FROM THE RESPONSE, NEVER DEFAULTED - see this file's own header, point 2.
    // A response with no usable `expires_in` gets `expiresAt = 0`, i.e. the token is used for THIS
    // call and re-fetched on the next one: one extra token request per call is a cost; handing out a
    // token that died eleven minutes ago is a bug nobody can read from the symptom.
    const expiresIn = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 0;
    this.token = {
      accessToken,
      expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 - TOKEN_SAFETY_MARGIN_MS : 0,
    };
    return accessToken;
  }

  /** Drops whatever token this instance holds. Called on a 401 by `request()` below, so a token
   *  revoked server-side mid-TTL self-heals on the very next call instead of failing every call
   *  until this process happens to restart - the same reasoning `pdp-client.ts#clearToken` holds. */
  clearToken(): void {
    this.token = null;
  }

  async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; contentType?: string; formData?: FormData },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }

      const token = await this.authenticate();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        // EVERY call, unconditionally - see this file's own header, point 3.
        'customer-id': this.customerId,
        Accept: 'application/json',
      };

      const fetchOpts: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'manual',
      };

      if (opts?.formData) {
        // Let fetch set Content-Type itself so the multipart boundary is the one it actually wrote.
        fetchOpts.body = opts.formData;
      } else if (opts?.body !== undefined && method !== 'GET') {
        headers['Content-Type'] = opts.contentType ?? 'application/json';
        fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }

      try {
        const res = await fetch(`${this.apiBaseUrl}${path}`, fetchOpts);
        const contentType = res.headers.get('content-type') ?? '';
        let respBody: unknown;
        if (contentType.includes('application/json')) {
          respBody = await res.json();
        } else {
          const text = await res.text();
          respBody = text || undefined;
        }

        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = new IopoleApiError(`Server error ${res.status}`, res.status, respBody, path);
          continue;
        }

        if (!res.ok) {
          const message =
            (respBody as { statusMessage?: string })?.statusMessage ??
            (respBody as { message?: string })?.message ??
            (respBody as { error?: string })?.error ??
            res.statusText;
          if (res.status === 401) this.clearToken();
          throw new IopoleApiError(String(message), res.status, respBody, path);
        }

        return respBody as T;
      } catch (err: unknown) {
        // A 4xx is the platform's own verdict on this exact request - retrying it changes nothing
        // and only delays the failure the caller has to see.
        if (err instanceof IopoleApiError && err.status >= 400 && err.status < 500) {
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

  /**
   * `POST /v1/invoice` - deposits one invoice file. Multipart, one part named `file`; the platform
   * accepts PDF (Factur-X) and XML (UBL / CII) alike, and decides the format from the content it
   * reads, not from a declared type. ASYNCHRONOUS by design: a 201 means the file was ACCEPTED for
   * processing and carries the invoice id to follow it by, never a conformity verdict - that arrives
   * later through `getStatusHistory()` below.
   */
  async sendInvoice(
    content: Buffer | Uint8Array,
    opts: { mime: string; fileName?: string },
  ): Promise<IopoleCreatedElement> {
    const extension = iopoleFileExtensionFor(opts.mime);
    const bytes = toBlobBytes(content);
    const form = new FormData();
    // The name the platform's own filename pattern is checked against - see
    // `iopoleFileExtensionFor`'s own header.
    const fileName = opts.fileName ?? `invoice.${extension}`;
    form.append('file', new Blob([bytes], { type: opts.mime }), fileName);

    return this.request<IopoleCreatedElement>('POST', '/v1/invoice', { formData: form });
  }

  /**
   * `GET /v1/invoice/{invoiceId}` - the deposited invoice's own metadata. Used by the live spec to
   * prove the id handed back is a handle the platform itself can resolve, not just an echo.
   *
   * A FOURTH documentation-versus-reality gap, found by running this for real on 2026-09-24: the
   * OpenAPI document declares this response as a single object, and the sandbox answers with an
   * ARRAY of one. Both shapes are accepted here - never the array silently indexed as if it were the
   * object, which is what turns "the platform changed its mind" into `undefined` fields nothing
   * explains. `null` when the platform knows no such invoice.
   */
  async getInvoice(invoiceId: string): Promise<IopoleInvoiceMetadata | null> {
    const body = await this.request<IopoleInvoiceMetadata | IopoleInvoiceMetadata[]>(
      'GET',
      `/v1/invoice/${encodeURIComponent(invoiceId)}`,
    );
    if (Array.isArray(body)) return body[0] ?? null;
    return body ?? null;
  }

  /**
   * `GET /v1/invoice/{invoiceId}/status-history` - the platform's own lifecycle for one deposit.
   * This is the endpoint a `conformity/pollers/` poller would be built on; no poller is registered
   * for this transport yet (see `iopole-transport.ts`'s own header), so today only the live spec
   * reads it.
   */
  async getStatusHistory(invoiceId: string): Promise<IopoleInvoiceStatus[]> {
    const body = await this.request<IopoleInvoiceStatus[] | { data?: IopoleInvoiceStatus[] }>(
      'GET',
      `/v1/invoice/${encodeURIComponent(invoiceId)}/status-history`,
    );
    if (Array.isArray(body)) return body;
    return Array.isArray(body?.data) ? body.data : [];
  }
}
