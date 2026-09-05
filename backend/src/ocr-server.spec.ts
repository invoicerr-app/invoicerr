import * as http from 'node:http';

import { createOcrServer, OcrServerOptions } from './ocr-server';

/** Boots a REAL `http.Server` (never a mocked request/response) on an ephemeral port, real
 *  round-trip HTTP requests — the same "boot the real thing" discipline `worker.ts`'s own
 *  health-check server gets proven by in `docker-compose.scale.yml`'s own healthcheck, brought into
 *  jest here via a real listening socket rather than a spawned OS process. */
async function withServer(options: OcrServerOptions, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createOcrServer(options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ocr server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A tiny real `node:http` stub standing in for `api.mistral.ai` — the SAME real-server discipline
 *  `mistral-client.spec.ts` already uses, reused here one layer up: this proves the OCR SERVICE's
 *  own HTTP wiring (body parsing, status mapping, JSON responses), never re-proving the Mistral
 *  mapping itself (that is `mistral-client.spec.ts`'s own job). */
async function withMistralStub(
  handler: http.RequestListener,
  run: (mistralBaseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mistral stub did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('createOcrServer — ROLE=ocr, booted for real', () => {
  it('GET /health answers 200 and reports whether a key is configured — never a secret value', async () => {
    await withServer({ mistralApiKey: 'sk-real-secret-do-not-leak' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(JSON.parse(body)).toEqual({ status: 'ok', engine: 'mistral', configured: true });
      expect(body).not.toContain('sk-real-secret-do-not-leak'); // the key NEVER appears in any response
    });
  });

  it('GET /health reports configured:false when no key is set — the honest self-host default', async () => {
    await withServer({ mistralApiKey: undefined }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(await res.json()).toEqual({ status: 'ok', engine: 'mistral', configured: false });
    });
  });

  it('POST /extract without a configured key answers a NAMED 503 — never a silent hang or a bare 500', async () => {
    await withServer({ mistralApiKey: undefined }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
      });
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toMatch(/MISTRAL_API_KEY is not configured/);
    });
  });

  it('POST /extract with missing/malformed fields answers a NAMED 400', async () => {
    await withServer({ mistralApiKey: 'sk-x' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime: 'application/pdf' }), // bytesBase64 missing
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/mime and bytesBase64/);
    });
  });

  it('POST /extract with an invalid JSON body answers a NAMED 400, never a crash', async () => {
    await withServer({ mistralApiKey: 'sk-x' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all {',
      });
      expect(res.status).toBe(400);
    });
  });

  it('POST /extract, configured, forwards to Mistral (stubbed) and returns the mapped proposal', async () => {
    await withMistralStub(
      (req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              pages: [],
              model: 'mistral-ocr-2505-completion',
              document_annotation: JSON.stringify({
                supplier: 'Fournisseur via Service SARL',
                supplierVatId: null,
                supplierNumber: null,
                issueDate: null,
                currency: null,
                netAmount: null,
                vatAmount: null,
                grossAmount: null,
                lines: null,
              }),
              usage_info: {},
            }),
          );
        });
      },
      async (mistralBaseUrl) => {
        await withServer({ mistralApiKey: 'sk-real', mistralBaseUrl }, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mime: 'application/pdf',
              bytesBase64: Buffer.from('%PDF fake bytes').toString('base64'),
            }),
          });
          const body = await res.json();

          expect(res.status).toBe(200);
          expect(body).toEqual({ fields: { supplier: 'Fournisseur via Service SARL' } });
        });
      },
    );
  });

  it('a Mistral 401 propagates through with the SAME status, named — never masked as a generic 500', async () => {
    await withMistralStub(
      (_req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid API Key' }));
      },
      async (mistralBaseUrl) => {
        await withServer({ mistralApiKey: 'sk-wrong', mistralBaseUrl }, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
          });
          const body = await res.json();

          expect(res.status).toBe(401);
          expect(body.error).toMatch(/Invalid API Key/);
        });
      },
    );
  });

  it('a Mistral 429 propagates through with the SAME status', async () => {
    await withMistralStub(
      (_req, res) => {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'rate limited' }));
      },
      async (mistralBaseUrl) => {
        await withServer({ mistralApiKey: 'sk-x', mistralBaseUrl }, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
          });
          expect(res.status).toBe(429);
        });
      },
    );
  });

  it('an unknown route answers a named 404', async () => {
    await withServer({ mistralApiKey: 'sk-x' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/nope`);
      expect(res.status).toBe(404);
    });
  });

  // The mandant's own required proof: the key never appears in ANY response body, under any outcome.
  it('the configured API key never appears in any /extract response body, success or failure', async () => {
    const SECRET = 'sk-must-never-leak-anywhere';
    await withMistralStub(
      (_req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid API Key' }));
      },
      async (mistralBaseUrl) => {
        await withServer({ mistralApiKey: SECRET, mistralBaseUrl }, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
          });
          const text = await res.text();
          expect(text).not.toContain(SECRET);

          const health = await (await fetch(`${baseUrl}/health`)).text();
          expect(health).not.toContain(SECRET);
        });
      },
    );
  });
});

/** A tiny real `node:http` stub standing in for the local engine (`apache/tika:latest-full` in
 *  production — see `ocr-service/local-client.ts`'s own header) — same "never a mocked fetch"
 *  discipline as `withMistralStub` above. */
async function withLocalOcrStub(
  handler: http.RequestListener,
  run: (localOcrUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('local OCR stub did not bind');
  const localOcrUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(localOcrUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('createOcrServer — OCR_ENGINE routing (mandant: "pour moi en local faut lancer un service Docker")', () => {
  it('OCR_ENGINE=local, configured: forwards to the local engine and returns the heuristically-mapped proposal', async () => {
    await withLocalOcrStub(
      (req, res) => {
        expect(req.method).toBe('PUT');
        expect(req.url).toBe('/tika');
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('Ma Societe SARL\nTotal TTC: 42.00 EUR\n');
      },
      async (localOcrUrl) => {
        await withServer({ ocrEngine: 'local', localOcrUrl }, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mime: 'application/pdf',
              bytesBase64: Buffer.from('%PDF fake bytes').toString('base64'),
            }),
          });
          const body = await res.json();

          expect(res.status).toBe(200);
          expect(body.fields.grossAmount).toBe(42);
          expect(body.fields.supplier).toBe('Ma Societe SARL');
        });
      },
    );
  });

  it("GET /health with OCR_ENGINE=local reports the engine and its OWN configured flag — never Mistral's", async () => {
    await withServer(
      { ocrEngine: 'local', localOcrUrl: 'http://127.0.0.1:9', mistralApiKey: undefined },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/health`);
        expect(await res.json()).toEqual({ status: 'ok', engine: 'local', configured: true });
      },
    );
  });

  it('OCR_ENGINE=local without LOCAL_OCR_URL answers a NAMED 503 — never silently falls back to Mistral', async () => {
    await withServer({ ocrEngine: 'local', localOcrUrl: undefined }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
      });
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toMatch(/LOCAL_OCR_URL is not configured/);
    });
  });

  it('GET /health with OCR_ENGINE=local and no LOCAL_OCR_URL honestly reports configured:false', async () => {
    await withServer({ ocrEngine: 'local', localOcrUrl: undefined }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(await res.json()).toEqual({ status: 'ok', engine: 'local', configured: false });
    });
  });

  it('a non-2xx from the local engine propagates through with the SAME status, named', async () => {
    await withLocalOcrStub(
      (_req, res) => {
        res.writeHead(422, { 'content-type': 'text/plain' });
        res.end('Unprocessable Entity');
      },
      async (localOcrUrl) => {
        await withServer({ ocrEngine: 'local', localOcrUrl }, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
          });
          expect(res.status).toBe(422);
        });
      },
    );
  });

  it('OCR_ENGINE absent still defaults to mistral — every deployment from before this env var existed', async () => {
    await withServer({ mistralApiKey: undefined }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect((await res.json()).engine).toBe('mistral');
    });
  });

  it('an unrecognized OCR_ENGINE is an honest, NAMED 501 on /extract — never guessed as either engine', async () => {
    await withServer({ ocrEngine: 'azure-form-recognizer' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime: 'application/pdf', bytesBase64: 'AAAA' }),
      });
      const body = await res.json();

      expect(res.status).toBe(501);
      expect(body.error).toMatch(/Unknown OCR_ENGINE "azure-form-recognizer"/);
    });
  });

  it('an unrecognized OCR_ENGINE is honestly NOT "configured" on /health either', async () => {
    await withServer({ ocrEngine: 'azure-form-recognizer' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(await res.json()).toEqual({ status: 'ok', engine: 'azure-form-recognizer', configured: false });
    });
  });
});
