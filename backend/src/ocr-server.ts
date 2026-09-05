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
 * ## `OCR_ENGINE` — FOLLOW-UP MANDANT DECISION (verbatim): "J'ai pas de clé Mistral, pour moi en
 * local faut lancer un service Docker qui fait ça" — a self-hoster with no cloud credentials at all
 * must still get OCR, 100% locally, no API key anywhere. `OCR_ENGINE` (`mistral` — the default, for
 * backward compatibility with every deployment from before this env var existed at all — or
 * `local`) picks which downstream engine THIS service calls; `MISTRAL_API_KEY` and `LOCAL_OCR_URL`
 * are each read only by the branch that needs them, so an operator only ever configures the ONE
 * credential their chosen engine actually requires. See `ocr-service/local-client.ts`'s own header
 * for which local Docker image was chosen and why, and the honest limits of what it can do that a
 * cloud model cannot. An `OCR_ENGINE` value that is neither — a typo, most likely — is never
 * silently treated as either default: `/extract` answers a NAMED 501, the honest "this instance
 * asked for an engine that does not exist" outcome, rather than guessing.
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

import { buildLocalOcrClient, LocalOcrError, LocalOcrTimeoutError } from './ocr-service/local-client';
import { buildMistralOcrClient, MistralOcrError, MistralOcrTimeoutError } from './ocr-service/mistral-client';

export interface OcrServerOptions {
  /** Defaults to `process.env.MISTRAL_API_KEY` — overridable for tests. */
  mistralApiKey?: string;
  /** Test-only override for the real Mistral base URL (`mistral-client.ts`'s own `baseUrl`). */
  mistralBaseUrl?: string;
  /** Defaults to `process.env.OCR_ENGINE`, itself defaulting to `'mistral'` — see this file's own
   *  header on why absent/unset means "mistral" (backward compatibility) while any OTHER unknown
   *  value is a named 501, never a silent fallback. */
  ocrEngine?: string;
  /** Defaults to `process.env.LOCAL_OCR_URL` — the local engine's own base URL, read only when
   *  `ocrEngine` is `'local'` (`local-client.ts`'s own `LocalOcrClientConfig.baseUrl`). */
  localOcrUrl?: string;
}

type OcrEngine = 'mistral' | 'local';

/** `undefined` for an unrecognized value — see this file's own header: neither engine is ever
 *  guessed for a typo'd `OCR_ENGINE`. */
function resolveEngine(raw: string | undefined): OcrEngine | undefined {
  const value = (raw ?? 'mistral').trim() || 'mistral';
  if (value === 'mistral' || value === 'local') return value;
  return undefined;
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
 * Maps a `MistralOcrError`/`LocalOcrError` (and their own `*TimeoutError` subclasses) to an HTTP
 * status this service's OWN caller (`mistral.ts`'s `MistralOcrProvider` — the same client code path
 * for BOTH engines, see that file's own header) can read meaningfully: the upstream status is
 * passed straight through where one exists (401/429 from Mistral, 422 from a local engine that
 * rejected a malformed file, …), a timeout becomes 504 (Gateway Timeout — the honest "upstream
 * never answered" status), and a network-level failure with no status at all becomes 502 (Bad
 * Gateway) — never a bare 500, which would falsely suggest THIS service's own code broke rather
 * than the downstream engine call it made on the caller's behalf.
 */
function statusForError(err: unknown): number {
  if (err instanceof MistralOcrTimeoutError || err instanceof LocalOcrTimeoutError) return 504;
  if (err instanceof MistralOcrError && err.status) return err.status;
  if (err instanceof LocalOcrError && err.status) return err.status;
  return 502;
}

/**
 * Builds the OCR service's `http.Server` — never calls `.listen()` itself (see this file's own
 * header on why `bootstrap()` is the only caller that does).
 */
export function createOcrServer(options: OcrServerOptions = {}): http.Server {
  const apiKey = options.mistralApiKey ?? process.env.MISTRAL_API_KEY;
  const localOcrUrl = (options.localOcrUrl ?? process.env.LOCAL_OCR_URL)?.trim();
  const requestedEngine = options.ocrEngine ?? process.env.OCR_ENGINE;
  const engine = resolveEngine(requestedEngine);

  // Per-engine readiness — see this file's own header: only the branch actually selected reads its
  // own credential/URL, and an unrecognized `OCR_ENGINE` is never "configured" at all (there is no
  // client to even attempt building for it).
  const configured =
    engine === 'mistral' ? Boolean(apiKey) : engine === 'local' ? Boolean(localOcrUrl) : false;

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      // `configured` lets a self-hoster's own healthcheck/logs tell "the container is up" apart from
      // "the container is up but MISSING its own credential/URL" — never a 5xx for the latter (a
      // healthcheck that flaps because an operator hasn't finished configuring yet would be a worse
      // failure mode than a GREEN health with an honest, visible flag). `engine` is surfaced too —
      // never the secret itself, only WHICH engine this instance believes it is running.
      sendJson(res, 200, { status: 'ok', engine: engine ?? requestedEngine, configured });
      return;
    }

    if (req.method === 'POST' && req.url === '/extract') {
      if (engine === undefined) {
        // The mandant's own required "501/absence honnête" outcome for a typo'd OCR_ENGINE — never
        // silently treated as either real engine.
        sendJson(res, 501, {
          error: `Unknown OCR_ENGINE "${requestedEngine}" — only "mistral" or "local" are supported.`,
        });
        return;
      }

      if (engine === 'mistral' && !apiKey) {
        // `OCR_SERVICE_URL` IS set (this service is reachable at all) but THIS service was never
        // given its own key — a real operator misconfiguration, distinct from "no service deployed
        // at all" (`mistral.ts`'s own `ExtractorNotReadyError` for a MISSING `OCR_SERVICE_URL`) —
        // named here so the caller never confuses the two.
        sendJson(res, 503, { error: 'MISTRAL_API_KEY is not configured on this OCR service instance.' });
        return;
      }
      if (engine === 'local' && !localOcrUrl) {
        sendJson(res, 503, { error: 'LOCAL_OCR_URL is not configured on this OCR service instance.' });
        return;
      }

      readJsonBody(req)
        .then(async (body) => {
          const { mime, bytesBase64 } = (body ?? {}) as { mime?: unknown; bytesBase64?: unknown };
          if (typeof mime !== 'string' || typeof bytesBase64 !== 'string' || !mime || !bytesBase64) {
            sendJson(res, 400, { error: 'mime and bytesBase64 (both strings) are required.' });
            return;
          }

          const bytes = Buffer.from(bytesBase64, 'base64');
          try {
            const proposal =
              engine === 'mistral'
                ? await buildMistralOcrClient({ apiKey: apiKey!, baseUrl: options.mistralBaseUrl }).extract(
                    bytes,
                    mime,
                  )
                : await buildLocalOcrClient({ baseUrl: localOcrUrl! }).extract(bytes, mime);
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
  const engine = resolveEngine(process.env.OCR_ENGINE);
  let readiness: string;
  if (engine === undefined) {
    readiness = `WARNING: unknown OCR_ENGINE "${process.env.OCR_ENGINE}" — /extract will refuse with 501`;
  } else if (engine === 'mistral') {
    readiness = process.env.MISTRAL_API_KEY
      ? 'engine=mistral, MISTRAL_API_KEY is set'
      : 'WARNING: engine=mistral but MISTRAL_API_KEY is NOT set — /extract will refuse with 503 until it is';
  } else {
    readiness = process.env.LOCAL_OCR_URL
      ? `engine=local, LOCAL_OCR_URL=${process.env.LOCAL_OCR_URL}`
      : 'WARNING: engine=local but LOCAL_OCR_URL is NOT set — /extract will refuse with 503 until it is';
  }
  server.listen(port, () => {
    console.log(`[ocr] ready — listening on :${port} (${readiness})`);
  });
}

// Never runs under `ocr-server.spec.ts` (imported as a module there, not executed as the entrypoint)
// — the same `require.main` guard convention Node scripts use to stay import-safe.
if (require.main === module) {
  bootstrap();
}
