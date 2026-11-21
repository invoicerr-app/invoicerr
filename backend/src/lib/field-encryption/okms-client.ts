import { readFileSync } from 'node:fs';
import { request } from 'node:https';

import type { OkmsSettings } from './config';

export class OkmsError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OkmsError';
  }
}

export interface OkmsClientOptions {
  attempts?: number;
  backoffMs?: number;
  /** Extra trust anchor, for tests against a private CA. Production relies on the system store. */
  ca?: string | Buffer;
  log?: (message: string) => void;
}

interface OkmsResponse {
  status: number;
  body: string;
}

/**
 * Minimal OVHcloud OKMS REST client, authenticated by client certificate (mTLS). Only unwraps data keys:
 * the key encryption key never leaves the KMS. Each request is aborted after `timeoutMs`.
 */
export class OkmsClient {
  private readonly cert: Buffer;
  private readonly key: Buffer;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(
    private readonly settings: OkmsSettings,
    private readonly options: OkmsClientOptions = {},
  ) {
    this.cert = readFileSync(settings.certPath);
    this.key = readFileSync(settings.keyPath);
    this.attempts = Math.max(1, options.attempts ?? 3);
    this.backoffMs = options.backoffMs ?? 250;
  }

  /** Decrypts a data key wrapped by the service key. Returns the raw key bytes. */
  async unwrapDataKey(wrapped: string): Promise<Buffer> {
    const path = `/v1/servicekey/${encodeURIComponent(this.settings.serviceKeyId)}/datakey/decrypt`;
    const body = await this.post(path, { key: wrapped });
    let plaintext: unknown;
    try {
      plaintext = (JSON.parse(body) as { plaintext?: unknown }).plaintext;
    } catch {
      throw new OkmsError(`OKMS answered ${path} with a body that is not JSON`, false);
    }
    if (typeof plaintext !== 'string' || !plaintext) {
      throw new OkmsError(`OKMS answered ${path} without a plaintext key`, false);
    }
    return Buffer.from(plaintext, 'base64');
  }

  private async post(path: string, payload: unknown): Promise<string> {
    let lastError: OkmsError | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await this.send(path, JSON.stringify(payload));
        if (res.status >= 200 && res.status < 300) return res.body;
        const detail = res.body.slice(0, 200);
        if (res.status < 500 && res.status !== 429) {
          throw new OkmsError(`OKMS refused ${path} with HTTP ${res.status}: ${detail}`, false);
        }
        lastError = new OkmsError(`OKMS answered ${path} with HTTP ${res.status}: ${detail}`, true);
      } catch (err) {
        if (err instanceof OkmsError && !err.retryable) throw err;
        lastError =
          err instanceof OkmsError
            ? err
            : new OkmsError(`OKMS unreachable on ${path}: ${(err as Error).message}`, true);
      }
      if (attempt < this.attempts) {
        const delay = this.backoffMs * 2 ** (attempt - 1);
        this.options.log?.(
          `${lastError.message} (attempt ${attempt}/${this.attempts}, retrying in ${delay} ms)`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new OkmsError(`${lastError!.message} after ${this.attempts} attempts`, true);
  }

  private send(path: string, body: string): Promise<OkmsResponse> {
    const url = new URL(`${this.settings.endpoint}${path}`);
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          cert: this.cert,
          key: this.key,
          ca: this.options.ca,
          signal: AbortSignal.timeout(this.settings.timeoutMs),
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      req.on('error', (err) => {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
          reject(new OkmsError(`OKMS did not answer ${path} within ${this.settings.timeoutMs} ms`, true));
        } else {
          reject(err);
        }
      });
      req.end(body);
    });
  }
}
