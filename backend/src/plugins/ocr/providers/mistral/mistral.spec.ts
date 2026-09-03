import * as http from 'node:http';

import { ExtractorNotReadyError } from '@/modules/documents/received-invoices/ocr/extractor';

import { MistralOcrProvider } from './mistral';

/** A tiny real `node:http` server standing in for the `ROLE=ocr` service's own `POST /extract` —
 *  never a mocked `fetch`, the same discipline `mistral-client.spec.ts`/`ocr-server.spec.ts` already
 *  use one layer down/up from this file. */
async function withOcrServiceStub(
  handler: http.RequestListener,
  run: (serviceUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub service did not bind');
  const serviceUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(serviceUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('MistralOcrProvider', () => {
  const provider = new MistralOcrProvider();
  const originalServiceUrl = process.env.OCR_SERVICE_URL;

  afterEach(() => {
    if (originalServiceUrl === undefined) delete process.env.OCR_SERVICE_URL;
    else process.env.OCR_SERVICE_URL = originalServiceUrl;
  });

  describe('supports', () => {
    it('supports only application/pdf — structural extraction already covers XML deposits', () => {
      expect(provider.supports('application/pdf')).toBe(true);
      expect(provider.supports('application/xml')).toBe(false);
      expect(provider.supports('text/xml')).toBe(false);
    });
  });

  describe('extract', () => {
    it('throws ExtractorNotReadyError, honestly, when OCR_SERVICE_URL is not set at all — the self-host default', async () => {
      delete process.env.OCR_SERVICE_URL;

      await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
        ExtractorNotReadyError,
      );
      await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
        /OCR_SERVICE_URL is not set/,
      );
    });

    it('posts mime + base64 bytes to {OCR_SERVICE_URL}/extract and returns the mapped proposal', async () => {
      let receivedPath = '';
      let receivedBody: Record<string, unknown> = {};

      await withOcrServiceStub(
        async (req, res) => {
          receivedPath = req.url ?? '';
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ fields: { supplier: 'Via OCR service' } }));
          });
        },
        async (serviceUrl) => {
          process.env.OCR_SERVICE_URL = serviceUrl;
          const bytes = new TextEncoder().encode('%PDF fake bytes');

          const result = await provider.extract(bytes, 'application/pdf');

          expect(result).toEqual({ fields: { supplier: 'Via OCR service' } });
          expect(receivedPath).toBe('/extract');
          expect(receivedBody).toEqual({
            mime: 'application/pdf',
            bytesBase64: Buffer.from(bytes).toString('base64'),
          });
        },
      );
    });

    it('tolerates a trailing slash on OCR_SERVICE_URL', async () => {
      let receivedPath = '';
      await withOcrServiceStub(
        (req, res) => {
          receivedPath = req.url ?? '';
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ fields: {} }));
        },
        async (serviceUrl) => {
          process.env.OCR_SERVICE_URL = `${serviceUrl}/`;
          await provider.extract(new Uint8Array([1]), 'application/pdf');
          expect(receivedPath).toBe('/extract');
        },
      );
    });

    it('a 503 from the service (deployed but keyless) is a NAMED failure — never ExtractorNotReadyError', async () => {
      await withOcrServiceStub(
        (_req, res) => {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'MISTRAL_API_KEY is not configured on this OCR service instance.' }),
          );
        },
        async (serviceUrl) => {
          process.env.OCR_SERVICE_URL = serviceUrl;

          await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
            /has no Mistral API key configured/,
          );
          await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.not.toBeInstanceOf(
            ExtractorNotReadyError,
          );
        },
      );
    });

    it('a Mistral-originated 401/429 relayed by the service is a NAMED failure, message preserved', async () => {
      await withOcrServiceStub(
        (_req, res) => {
          res.writeHead(429, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mistral OCR quota or rate limit exceeded (429): ...' }));
        },
        async (serviceUrl) => {
          process.env.OCR_SERVICE_URL = serviceUrl;

          await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
            /quota or rate limit/,
          );
        },
      );
    });

    it('an unreachable OCR_SERVICE_URL is a NAMED failure, never a silent hang', async () => {
      process.env.OCR_SERVICE_URL = 'http://127.0.0.1:1'; // a port nothing listens on

      await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
        /OCR service request failed/,
      );
    });

    it('a non-JSON 200 from the service is a NAMED failure, never a crash', async () => {
      await withOcrServiceStub(
        (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('<html>oops</html>');
        },
        async (serviceUrl) => {
          process.env.OCR_SERVICE_URL = serviceUrl;
          await expect(provider.extract(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(
            /non-JSON response/,
          );
        },
      );
    });
  });
});
