/**
 * TODO_PRODUIT.md T5(c) — MANDANT AMENDMENT (mid-task, verbatim): "Faudrait que le docker puisse
 * embarquer une api pour l'OCR, comme ça si j'héberge l'appli pour le saas, personne a besoin de le
 * configurer y'a que la selfhost qui tourne en full local." — a THIRD container role, `ROLE=ocr`,
 * alongside the existing `api`/`worker` (see `entrypoint.sh`'s own "one image, N roles" switch).
 * This is the ONLY process in the whole deployment that ever holds `MISTRAL_API_KEY` — the main
 * backend (`api`/`worker`) never sees it, never stores it, only knows `OCR_SERVICE_URL`
 * (`plugins/ocr/providers/mistral/mistral.ts`, this task's own "plugin"). An operator running the
 * SaaS offering enables this ONE service, ONCE, with their own key, and every company on that
 * instance gets OCR for free; a self-hoster who never sets `OCR_SERVICE_URL` (the default in
 * `docker-compose.yml` — this service is opt-in, see that file's own comment) gets the honest,
 * full-local-by-default "no OCR" outcome the mandant's own root instruction already required.
 *
 * Deliberately bare `node:http`, no Nest, no Express, no new dependency — this role does exactly
 * two things (`GET /health`, `POST /extract`) and needs none of Nest's DI/module machinery, the same
 * reasoning `worker.ts`'s own minimal health-check server (its OWN bare `http.createServer`, port
 * 3001) already established for a single-purpose container role in this same codebase.
 *
 * `createOcrServer` is exported SEPARATELY from `bootstrap()` so `ocr-server.spec.ts` can boot the
 * REAL server object (a real `http.Server`, real requests) without opening the real default port or
 * reading the real `MISTRAL_API_KEY` — the same "factory function vs. side-effecting bootstrap"
 * split `mistral-client.ts`'s own `buildMistralOcrClient` already uses for testability.
 */
import * as http from 'node:http';

import { buildMistralOcrClient, MistralOcrError, MistralOcrTimeoutError } from './ocr-service/mistral-client';

export interface OcrServerOptions {
  /** Defaults to `process.env.MISTRAL_API_KEY` — overridable for tests. */
  mistralApiKey?: string;
  /** Test-only override for the real Mistral base URL (`mistral-client.ts`'s own `baseUrl`). */
  mistralBaseUrl?: string;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Maps a `MistralOcrError`/`MistralOcrTimeoutError` to an HTTP status this service's OWN caller
 * (`mistral.ts`'s `MistralOcrProvider`) can read meaningfully: the upstream Mistral status is passed
 * straight through where one exists (401/429/… — the caller sees exactly what Mistral said), a
 * timeout becomes 504 (Gateway Timeout — the honest "upstream never answered" status), and a
 * network-level failure with no status at all becomes 502 (Bad Gateway) — never a bare 500, which
 * would falsely suggest THIS service's own code broke rather than the Mistral call it made on the
 * caller's behalf.
 */
function statusForError(err: unknown): number {
  if (err instanceof MistralOcrTimeoutError) return 504;
  if (err instanceof MistralOcrError && err.status) return err.status;
  return 502;
}

/**
 * Builds the OCR service's `http.Server` — never calls `.listen()` itself (see this file's own
 * header on why `bootstrap()` is the only caller that does).
 */
export function createOcrServer(options: OcrServerOptions = {}): http.Server {
  const apiKey = options.mistralApiKey ?? process.env.MISTRAL_API_KEY;

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      // `configured` lets a self-hoster's own healthcheck/logs tell "the container is up" apart from
      // "the container is up but MISSING its own key" — never a 5xx for the latter (a healthcheck
      // that flaps because an operator hasn't set the key yet would be a worse failure mode than a
      // GREEN health with an honest, visible flag).
      sendJson(res, 200, { status: 'ok', configured: Boolean(apiKey) });
      return;
    }

    if (req.method === 'POST' && req.url === '/extract') {
      if (!apiKey) {
        // `OCR_SERVICE_URL` IS set (this service is reachable at all) but THIS service was never
        // given its own key — a real operator misconfiguration, distinct from "no service deployed
        // at all" (`mistral.ts`'s own `ExtractorNotReadyError` for a MISSING `OCR_SERVICE_URL`) —
        // named here so the caller never confuses the two.
        sendJson(res, 503, { error: 'MISTRAL_API_KEY is not configured on this OCR service instance.' });
        return;
      }

      readJsonBody(req)
        .then(async (body) => {
          const { mime, bytesBase64 } = (body ?? {}) as { mime?: unknown; bytesBase64?: unknown };
          if (typeof mime !== 'string' || typeof bytesBase64 !== 'string' || !mime || !bytesBase64) {
            sendJson(res, 400, { error: 'mime and bytesBase64 (both strings) are required.' });
            return;
          }

          const client = buildMistralOcrClient({ apiKey, baseUrl: options.mistralBaseUrl });
          try {
            const proposal = await client.extract(Buffer.from(bytesBase64, 'base64'), mime);
            sendJson(res, 200, proposal);
          } catch (err) {
            sendJson(res, statusForError(err), {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

function bootstrap(): void {
  const port = Number(process.env.PORT) || 3002;
  const server = createOcrServer();
  server.listen(port, () => {
    const keyStatus = process.env.MISTRAL_API_KEY
      ? 'MISTRAL_API_KEY is set'
      : 'WARNING: MISTRAL_API_KEY is NOT set — /extract will refuse with 503 until it is';
    console.log(`[ocr] ready — listening on :${port} (${keyStatus})`);
  });
}

// Never runs under `ocr-server.spec.ts` (imported as a module there, not executed as the entrypoint)
// — the same `require.main` guard convention Node scripts use to stay import-safe.
if (require.main === module) {
  bootstrap();
}
