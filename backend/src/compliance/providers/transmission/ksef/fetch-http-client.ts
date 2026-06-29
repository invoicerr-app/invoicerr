/**
 * Fetch-based HTTP client adapter for the KSeF client.
 * Wraps the global `fetch` with timeout and retry logic.
 */
import { KsefHttpClient, HttpRequest, HttpResponse } from './ksef-client';

export interface FetchHttpClientOpts {
  /** Request timeout in ms (default: 30_000). */
  timeoutMs?: number;
  /** Max retries on 5xx / network errors (default: 3). */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export class FetchKsefHttpClient implements KsefHttpClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: FetchHttpClientOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 500ms, 1000ms, 2000ms...
        await sleep(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {};
        if (req.body !== undefined && req.method !== 'GET') {
          headers['Content-Type'] = 'application/json';
        }
        if (req.headers) {
          Object.assign(headers, req.headers);
        }

        const fetchOpts: RequestInit = {
          method: req.method,
          headers,
          signal: controller.signal,
        };
        if (req.body !== undefined && req.method !== 'GET') {
          fetchOpts.body = JSON.stringify(req.body);
        }

        const res = await fetch(req.path, fetchOpts);
        clearTimeout(timer);

        const contentType = res.headers.get('content-type') ?? '';
        let body: unknown;
        if (contentType.includes('application/json')) {
          body = await res.json();
        } else {
          const text = await res.text();
          body = text || undefined;
        }

        // Don't retry client errors (4xx) — only 5xx and network errors
        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = new Error(`KSeF ${res.status}`);
          continue;
        }

        return { status: res.status, body };
      } catch (err: unknown) {
        clearTimeout(timer);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
