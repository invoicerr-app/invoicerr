/**
 * HTTP client for the A-Cube API (`acubeapi.com`) - the platform behind the "acube" transport
 * (`transports/acube-transport.ts`). A-Cube is an Italian provider registered by the DGFiP and, on
 * the same account, a Peppol access point; this client speaks ONE jurisdiction today (Italy, the
 * `gov-it` invoicing API), for the reason the host table below states.
 *
 * ## What was observed first-hand, and what was only read
 *
 * Everything in this header marked LIVE was obtained by running the request against the real
 * sandbox on 2026-09-24 and reading the real answer, never inferred from the documentation:
 *
 *  - LIVE - `POST https://common.api.acubeapi.com/login`, JSON body `{ email, password,
 *    environment }` with `environment: "sandbox"`, answers `HTTP 200 {"token": "<JWT>"}`. The JWT is
 *    RS256 and its payload carries `exp = iat + 86400` (the 24 hours the documentation claims,
 *    confirmed by decoding the real token) plus a `roles` map whose KEYS are the per-jurisdiction API
 *    hosts this account may reach: `it.api.acubeapi.com`, `fr.api.acubeapi.com`,
 *    `peppol.api.acubeapi.com`, `de.api.acubeapi.com`, `pl.api.acubeapi.com` and a few more. That map
 *    is the reason the `AcubeJurisdiction` seam below exists at all: the SAME login already grants
 *    the Peppol and French roles, so widening this client later is a host-table row plus a payload
 *    decision, never a second authentication design.
 *  - LIVE - the environment is not a request parameter on the jurisdiction API, it is a DIFFERENT
 *    HOST: `GET https://it-sandbox.api.acubeapi.com/invoices` answers `200 []` with a sandbox token,
 *    while the SAME token against `https://it.api.acubeapi.com/invoices` answers
 *    `401 {"code":401,"message":"Invalid JWT Token"}`. A token is scoped to the environment it was
 *    minted for, so mixing the two is a hard refusal rather than a silent cross-environment send -
 *    which is exactly the failure mode that would be worth fearing here.
 *  - READ, then LIVE - `POST /invoices` with `Content-Type: application/xml` deposits a FatturaPA
 *    document and answers `HTTP 202` with a body carrying the invoice `uuid`
 *    (docs.acubeapi.com/documentation/italy/gov-it/invoices/sending-invoice). The deposit is
 *    ASYNCHRONOUS: the uuid comes back immediately, the SdI verdict lands later.
 *
 * ## Why there is no outbound-URL guard here, unlike `pdp/pdp-client.ts`
 *
 * That client validates its `baseUrl` through `@/utils/outbound-url` on every call because the URL
 * is a TENANT-SUPPLIED credential (`PUT /api/company/channels/pdp`) and could be pointed at an
 * internal address. Nothing here is tenant-supplied: the login URL and both jurisdiction hosts are
 * module constants below, exactly the way `ksef/ksef-client.ts` hardcodes its own two environments.
 * There is no address for a tenant to influence, so there is no SSRF primitive to close. What IS
 * kept from `pdp-client.ts` is `redirect: 'manual'` - a host answering 30x must never have this
 * request, carrying a bearer token, followed somewhere else automatically.
 *
 * ## Deliberately NOT built here
 *
 * Following the SdI verdict past the deposit (the `waiting → sent → invoice-error` marking A-Cube
 * exposes, and the webhooks it can push) needs a poller in `conformity/pollers/`, which is separate
 * work from the deposit itself - the same named remainder `pdp-transport.ts` and `ksef-transport.ts`
 * already carry. `getInvoice()` below is the read side such a poller would build on; nothing calls it
 * in production today, and it is kept rather than trimmed for exactly that reason.
 */

/** LIVE-confirmed: the two are different HOSTS, not a request parameter - see this file's header. */
export type AcubeEnvironment = 'sandbox' | 'production';

/**
 * Which per-jurisdiction A-Cube API this client talks to. Only `'it'` is implemented: it is the one
 * whose payload this repository can already build (FatturaPA, `formats/national/fatturapa-provider.ts`,
 * gated by the real vendored `Schema_VFPR12.xsd`). The account's own token already carries
 * `ROLE_WRITER` for the French, German, Polish and Peppol hosts (observed live, see the header), so
 * adding one is a row in `JURISDICTION_HOSTS` plus a decision about which format to deposit - never
 * a rewrite of this client. Left as a union of one rather than a bare string so that adding a member
 * forces the host table to be completed in the same edit.
 */
export type AcubeJurisdiction = 'it';

/** LIVE-confirmed 2026-09-24: answers 200 with a JWT for `environment: "sandbox"`. A-Cube also
 *  publishes `common-sandbox.api.acubeapi.com`; this codebase uses the host it actually proved,
 *  with the environment carried in the body, rather than the one it merely read about. */
const LOGIN_URL = 'https://common.api.acubeapi.com/login';

const JURISDICTION_HOSTS: Record<AcubeJurisdiction, Record<AcubeEnvironment, string>> = {
  it: {
    sandbox: 'https://it-sandbox.api.acubeapi.com',
    production: 'https://it.api.acubeapi.com',
  },
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/** Applied only when the JWT's own `exp` cannot be read - see `decodeTokenExpiry`. Short on
 *  purpose: re-authenticating a little too often is merely wasteful, trusting a garbage expiry is
 *  not (the same reasoning `ksef-transport.ts` already spells out for its own authority-supplied
 *  `validUntil`). */
const FALLBACK_TOKEN_TTL_MS = 5 * 60_000;

/** Renew this far before the token's own expiry, so a request never leaves with a token that
 *  expires while it is in flight. */
const TOKEN_RENEWAL_MARGIN_MS = 60_000;

export interface AcubeClientConfig {
  email: string;
  password: string;
  environment: AcubeEnvironment;
  /** Defaults to `'it'` - the only jurisdiction implemented, see `AcubeJurisdiction`. */
  jurisdiction?: AcubeJurisdiction;
}

/** What `POST /invoices` answers with - `uuid` is the platform-assigned reference this whole
 *  integration hangs on. Widened with an index signature because A-Cube returns more fields than
 *  this transport reads, and pinning an exhaustive shape to an external API this project does not
 *  own would turn a harmless addition on their side into a type error on ours. */
export interface AcubeInvoiceRef {
  uuid?: string;
  [key: string]: unknown;
}

export class AcubeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly endpoint: string,
  ) {
    super(`A-Cube ${endpoint}: ${status} - ${message}`);
    this.name = 'AcubeApiError';
  }
}

interface TokenState {
  token: string;
  expiresAt: number;
}

/**
 * Reads `exp` out of the JWT A-Cube just issued, so this client renews on the authority's OWN
 * expiry rather than on a TTL guessed here. Never throws on a malformed token: an unreadable `exp`
 * falls back to `FALLBACK_TOKEN_TTL_MS` (see that constant's own comment) instead of either crashing
 * or caching an unusable value for 24 hours.
 */
function decodeTokenExpiry(token: string): number | null {
  const segments = token.split('.');
  if (segments.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A-Cube answers errors in two different shapes depending on which layer refused: the JWT firewall
 *  uses `{code, message}`, the API-Platform layer behind it uses RFC 7807 `{title, detail, status}`.
 *  Both observed live on 2026-09-24. Read in that order so the most specific explanation wins, with
 *  the HTTP status text as the last resort. */
function describeError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['detail', 'message', 'title', 'error']) {
      if (typeof b[key] === 'string' && b[key]) return b[key] as string;
    }
  }
  if (typeof body === 'string' && body) return body.slice(0, 500);
  return fallback;
}

export class AcubeClient {
  private readonly email: string;
  private readonly password: string;
  private readonly environment: AcubeEnvironment;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  private token: TokenState | null = null;

  constructor(config: AcubeClientConfig, opts?: { timeoutMs?: number; maxRetries?: number }) {
    this.email = config.email;
    this.password = config.password;
    this.environment = config.environment;
    this.baseUrl = JURISDICTION_HOSTS[config.jurisdiction ?? 'it'][config.environment];
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** The jurisdiction host this instance resolved - read by the live spec and by log lines, so
   *  "which environment did that deposit actually go to" is answerable from the record alone. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Exchanges the account's e-mail + password for a 24-hour JWT. This is a PASSWORD exchange, not
   * an API key and not OAuth2 client_credentials: A-Cube has no per-integration key concept, the
   * same credentials that open the web console open the API. That is precisely why the stored
   * channel config for this provider must be a dedicated, generated password used for nothing else
   * (see `acube-transport.ts`'s own header).
   *
   * The password is never logged, never placed in a URL, and never surfaced in a thrown message:
   * `describeError` reads the platform's own explanation, and a 401 here answers "invalid
   * credentials", nothing more.
   */
  async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_RENEWAL_MARGIN_MS) {
      return this.token.token;
    }

    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
        environment: this.environment,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
      // Never follow a redirect automatically: this request carries the account's own password, and
      // a 30x would hand it to whatever the new Location names. Same discipline `pdp-client.ts`
      // holds for its own token endpoint.
      redirect: 'manual',
    });

    const body = await readBody(res);
    if (!res.ok) {
      throw new AcubeApiError(describeError(body, res.statusText), res.status, body, 'login');
    }

    const token = (body as { token?: unknown })?.token;
    if (typeof token !== 'string' || !token) {
      // A 200 carrying no usable token is a malformed response, not an edge case worth papering
      // over: caching an empty string here would make every subsequent call fail Bearer auth with
      // no explanation until the cache happened to expire. Refuse loudly, before caching anything -
      // the exact failure `pdp-client.ts#authenticate` documents having been burned by.
      throw new AcubeApiError(
        'login answered 200 but carried no usable token - refusing to cache an unusable value.',
        res.status,
        body,
        'login',
      );
    }

    this.token = { token, expiresAt: decodeTokenExpiry(token) ?? Date.now() + FALLBACK_TOKEN_TTL_MS };
    return token;
  }

  /** Drops the cached token so the next call re-authenticates. Called on a 401: the token could
   *  have been revoked server-side before this client's own margin says it should be, and without
   *  this every later call would keep presenting the same dead token. */
  clearToken(): void {
    this.token = null;
  }

  /**
   * Deposits one FatturaPA document. `Content-Type: application/xml` is what selects the
   * original-format branch of `POST /invoices` (the same endpoint also accepts A-Cube's own JSON
   * representation, which this repository has no reason to build: it already emits FatturaPA gated
   * by the real XSD, and depositing the XML means the bytes archived and the bytes sent are the same
   * bytes).
   *
   * Returns whatever the platform answered, uuid included. It deliberately does NOT enforce
   * "the uuid is non-empty" - that is the transport's hard-success contract to state and to fail on,
   * in one place, next to the error message the user will actually read.
   */
  async sendInvoice(xml: Buffer | Uint8Array): Promise<AcubeInvoiceRef> {
    return this.request<AcubeInvoiceRef>('POST', '/invoices', {
      body: Buffer.from(xml).toString('utf8'),
      contentType: 'application/xml',
    });
  }

  /**
   * One deposited invoice, by uuid. `send()` never calls it: what it answers (`marking`,
   * `notifications`) is the SdI verdict this transport deliberately does not follow. It exists for
   * two honest reasons - `acube.live.spec.ts` calls it to read a deposit BACK off the platform
   * rather than trust the response it was just handed, and it is the read side a
   * `conformity/pollers/` poller would build on once following that verdict becomes its own piece of
   * work (see this file's header).
   */
  async getInvoice(uuid: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/invoices/${encodeURIComponent(uuid)}`);
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { body?: string; contentType?: string },
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }

      const token = await this.authenticate();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (opts?.contentType) headers['Content-Type'] = opts.contentType;

      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: opts?.body,
          signal: AbortSignal.timeout(this.timeoutMs),
          // See `authenticate()`'s identical option: a validated host answering 30x must never have
          // this bearer-carrying request followed somewhere else automatically.
          redirect: 'manual',
        });

        const body = await readBody(res);

        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = new AcubeApiError(`server error ${res.status}`, res.status, body, path);
          continue;
        }

        if (!res.ok) {
          if (res.status === 401) this.clearToken();
          throw new AcubeApiError(describeError(body, res.statusText), res.status, body, path);
        }

        return body as T;
      } catch (err) {
        // A 4xx is the platform's own verdict on this request - retrying it would only repeat it.
        if (err instanceof AcubeApiError && err.status >= 400 && err.status < 500) throw err;
        if (attempt < this.maxRetries) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }
}

/** JSON when the platform says JSON, plain text otherwise - an error body is not always JSON (the
 *  JWT firewall in front of the API answers a different shape from the API itself), and calling
 *  `res.json()` on it would throw a parse error that hides the real explanation. */
async function readBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text) return undefined;
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
