/**
 * `PeppolApHttpClient` in isolation — against a REAL local HTTP server (`node:http`, no TLS/mTLS
 * needed, unlike `sdi/sdicoop-client.spec.ts`'s own stub: the generic AP gateway is plain
 * Bearer-token REST). A genuine request goes out over the loopback interface and a genuine JSON
 * response comes back — proves the actual `fetch()` wiring (headers, URL shape, base64 encoding),
 * never a `jest.mock('node:http')`/`jest.spyOn(global, 'fetch')` stand-in for it.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { PeppolApHttpClient } from './peppol-client';

interface CapturedRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Waits for the real `'listening'` event before reading `.address()` — `server.listen(0, …)` binds
 *  the port ASYNCHRONOUSLY (libuv), so reading `.address()` on the very next synchronous line is a
 *  genuine race (it returns `null` until binding completes) — discovered running this very spec. */
function startStubServer(
  handler: (req: CapturedRequest, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        handler(
          {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          },
          res,
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** `closeAllConnections()` forcibly drops any lingering keep-alive socket `fetch()`'s own connection
 *  pooling can leave open — without it, `server.close()` alone waits for the CLIENT to drop the
 *  connection first, which was leaving an open handle behind (discovered running this very spec). */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

describe('PeppolApHttpClient — real local HTTP stub', () => {
  describe('send()', () => {
    it('POSTs the base64 document to /api/v1/send with a Bearer token, and returns the AP-assigned messageId', async () => {
      let captured: CapturedRequest | undefined;
      const { server, url } = await startStubServer((req, res) => {
        captured = req;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: 'msg-abc-123', status: 'SENT' }));
      });

      try {
        const client = new PeppolApHttpClient({
          accessPointUrl: url,
          apiKey: 'secret-key',
          environment: 'TEST',
        });
        const documentBytes = new TextEncoder().encode('<Invoice>hello</Invoice>');

        const result = await client.send({
          senderParticipantId: '0009:11112222',
          receiverParticipantId: '0009:33334444',
          documentTypeId: 'urn:doctype',
          processId: 'urn:process',
          documentBytes,
          idempotencyKey: 'INV-2026-0001',
        });

        expect(result).toEqual({ messageId: 'msg-abc-123', status: 'SENT' });
        expect(captured?.method).toBe('POST');
        expect(captured?.url).toBe('/api/v1/send');
        expect(captured?.headers.authorization).toBe('Bearer secret-key');

        const body = JSON.parse(captured!.body) as {
          sender: string;
          receiver: string;
          document: string;
          idempotencyKey: string;
          environment: string;
        };
        expect(body.sender).toBe('0009:11112222');
        expect(body.receiver).toBe('0009:33334444');
        expect(body.idempotencyKey).toBe('INV-2026-0001');
        expect(body.environment).toBe('TEST');
        // The EXACT bytes sent — round-tripped through base64, proving no silent truncation/mangling.
        expect(Buffer.from(body.document, 'base64').toString('utf-8')).toBe('<Invoice>hello</Invoice>');
      } finally {
        await closeServer(server);
      }
    });

    it('treats a real HTTP error from the AP as a thrown failure, never a silent empty success', async () => {
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_api_key' }));
      });

      try {
        const client = new PeppolApHttpClient({
          accessPointUrl: url,
          apiKey: 'wrong-key',
          environment: 'TEST',
        });
        await expect(
          client.send({
            senderParticipantId: '0009:1',
            receiverParticipantId: '0009:2',
            documentTypeId: 'urn:doctype',
            processId: 'urn:process',
            documentBytes: new Uint8Array([1, 2, 3]),
          }),
        ).rejects.toThrow(/HTTP 401/);
      } finally {
        await closeServer(server);
      }
    });

    // THE HARD-SUCCESS CONTRACT, at the client's own level: an AP that answers 200 OK with NO
    // messageId at all is a real, observed shape a buggy/misbehaving vendor could return — the client
    // itself never invents one, it returns an empty string, and the TRANSPORT layer
    // (`peppol-transport.spec.ts`) is what turns that into a hard failure — same split
    // `pdp-client.ts`/`pdp-transport.ts` already hold.
    it('returns an EMPTY messageId (never invents one) when the AP response omits it', async () => {
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'QUEUED' }));
      });

      try {
        const client = new PeppolApHttpClient({ accessPointUrl: url, apiKey: 'k', environment: 'TEST' });
        const result = await client.send({
          senderParticipantId: '0009:1',
          receiverParticipantId: '0009:2',
          documentTypeId: 'urn:doctype',
          processId: 'urn:process',
          documentBytes: new Uint8Array([1]),
        });
        expect(result.messageId).toBe('');
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('getStatus()', () => {
    it('GETs /api/v1/status/{messageId} and normalizes the AP status vocabulary', async () => {
      let captured: CapturedRequest | undefined;
      const { server, url } = await startStubServer((req, res) => {
        captured = req;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: 'msg-abc-123', status: 'delivered' }));
      });

      try {
        const client = new PeppolApHttpClient({ accessPointUrl: url, apiKey: 'k', environment: 'TEST' });
        const result = await client.getStatus('msg-abc-123');

        expect(captured?.method).toBe('GET');
        expect(captured?.url).toBe('/api/v1/status/msg-abc-123');
        expect(result.status).toBe('DELIVERED');
      } finally {
        await closeServer(server);
      }
    });

    it('surfaces a FAILED status with its mlrDescription', async () => {
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: 'm', status: 'FAILED', mlrDescription: 'invalid receiver' }));
      });

      try {
        const client = new PeppolApHttpClient({ accessPointUrl: url, apiKey: 'k', environment: 'TEST' });
        const result = await client.getStatus('m');
        expect(result.status).toBe('FAILED');
        expect(result.mlrDescription).toBe('invalid receiver');
      } finally {
        await closeServer(server);
      }
    });
  });
});
