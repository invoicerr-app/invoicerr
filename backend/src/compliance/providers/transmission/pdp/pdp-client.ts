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
 */

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

export interface SuperPdpInvoice {
  id: number;
  direction: 'in' | 'out';
  external_id?: string;
  status_code: string[];
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

  // -----------------------------------------------------------------------
  // OAuth2
  // -----------------------------------------------------------------------

  async authenticate(): Promise<string> {
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
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new PdpApiError(
        `OAuth token error: ${(json as { error_description?: string }).error_description ?? res.statusText}`,
        res.status,
        json,
        'oauth2/token',
      );
    }

    const accessToken = json.access_token as string;
    const expiresIn = (json.expires_in as number) ?? 3600;
    this.token = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return accessToken;
  }

  /** Force re-authentication (used by poll() — KSeF lesson: no in-memory cache as source of truth). */
  clearToken(): void {
    this.token = null;
  }

  // -----------------------------------------------------------------------
  // Generic HTTP
  // -----------------------------------------------------------------------

  async request<T>(method: string, path: string, opts?: {
    body?: unknown;
    contentType?: string;
    formData?: FormData;
  }): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }

      const token = await this.authenticate();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };

      const fetchOpts: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      };

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
          const msg = (respBody as { errorMessage?: string })?.errorMessage
            ?? (respBody as { error?: string })?.error
            ?? (respBody as { message?: string })?.message
            ?? res.statusText;
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
  async sendInvoice(content: Buffer | Uint8Array, opts?: {
    externalId?: string;
    contentType?: string;
    disablePreCheck?: boolean;
  }): Promise<SuperPdpInvoice> {
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

  async getInvoice(id: number, format?: 'en16931' | 'original' | 'cii' | 'ubl' | 'factur-x'): Promise<SuperPdpInvoice> {
    const params = format ? `?format=${format}` : '';
    return this.request<SuperPdpInvoice>('GET', `/v1.beta/invoices/${id}${params}`);
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
    form.append('flowInfo', new Blob([JSON.stringify({
      flowSyntax: flowInfo.flowSyntax,
      flowProfile: flowInfo.flowProfile ?? 'Extended-CTC-FR',
      name: flowInfo.name,
      processingRule: flowInfo.processingRule ?? 'B2B',
      trackingId: flowInfo.trackingId,
    })], { type: 'application/json' }));

    return this.request<AfnorFlowInfo>('POST', '/afnor-flow/v1/flows', {
      formData: form,
    });
  }

  async searchFlows(filters: {
    flowType?: string;
    flowDirection?: 'In' | 'Out';
    trackingId?: string;
    ackStatus?: 'Pending' | 'Ok' | 'Error';
    updatedAfter?: string;
  }, limit = 10): Promise<AfnorFlowSearchResult> {
    return this.request<AfnorFlowSearchResult>('POST', '/afnor-flow/v1/flows/search', {
      body: { where: filters, limit },
    });
  }

  async getFlow(flowId: string): Promise<AfnorFlowInfo> {
    return this.request<AfnorFlowInfo>('GET', `/afnor-flow/v1/flows/${encodeURIComponent(flowId)}`);
  }

  // -----------------------------------------------------------------------
  // AFNOR Directory Service (XP Z12-013 standard)
  // -----------------------------------------------------------------------

  async searchDirectoryLines(filters: {
    siret?: string;
    siren?: string;
    addressingIdentifier?: string;
  }, limit = 10): Promise<DirectoryLineSearchResult> {
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
  const src = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, srcByteOffset(data), srcByteLength(data));
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
