/**
 * `AnafClient` in isolation — against a REAL local HTTP server (`node:http`), the same "a genuine
 * request goes out over the loopback interface and a genuine response comes back" discipline
 * `peppol/peppol-client.spec.ts`'s own header establishes: never a `jest.mock('node:http')`/
 * `jest.spyOn(global, 'fetch')` stand-in for the actual `fetch()` wiring. The stub server answers with
 * the REAL ANAF wire shape (a small XML `<header>` element) — see `anaf-client.ts`'s own header on why
 * that, not JSON, is what this client actually has to parse.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { AnafApiError, AnafClient, mapAnafStatus } from './anaf-client';

interface CapturedRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Waits for the real `'listening'` event before reading `.address()` — the same async-bind race
 *  `peppol-client.spec.ts#startStubServer`'s own header already documents. */
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

/** `closeAllConnections()` drops any lingering keep-alive socket — same leak `peppol-client.spec.ts#
 *  closeServer`'s own header already documents. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/** A stub server that answers the token endpoint at `/token` with a fixed bearer token, and delegates
 *  everything else to `onOther` — every test below needs a working token exchange before it can reach
 *  the endpoint it actually wants to exercise. */
function startAnafStub(onOther: (req: CapturedRequest, res: http.ServerResponse) => void) {
  return startStubServer((req, res) => {
    if (req.url?.startsWith('/token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'bearer-token-1', expires_in: 3600 }));
      return;
    }
    onOther(req, res);
  });
}

function buildConfig(baseUrl: string, tokenUrl: string) {
  return {
    baseUrl,
    tokenUrl,
    clientId: 'client-1',
    clientSecret: 'secret-1',
    refreshToken: 'refresh-1',
    cif: '12345678',
  };
}

describe('AnafClient — real local HTTP stub', () => {
  describe('authenticate() (exercised through uploadInvoice)', () => {
    it("exchanges the refresh token via Basic-Auth'd POST — never client_credentials", async () => {
      let tokenReq: CapturedRequest | undefined;
      const { server, url } = await startStubServer((req, res) => {
        if (req.url?.startsWith('/token')) {
          tokenReq = req;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'bearer-token-1', expires_in: 3600 }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<header ExecutionStatus="0" index_incarcare="5000000001"/>');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        await client.uploadInvoice('<Invoice/>');

        expect(tokenReq?.method).toBe('POST');
        expect(tokenReq?.headers.authorization).toBe(
          `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`,
        );
        expect(tokenReq?.body).toContain('grant_type=refresh_token');
        expect(tokenReq?.body).toContain('refresh_token=refresh-1');
        expect(tokenReq?.body).not.toContain('client_credentials');
      } finally {
        await closeServer(server);
      }
    });

    it('caches the access token — a second call does not hit /token again', async () => {
      let tokenCalls = 0;
      const { server, url } = await startStubServer((req, res) => {
        if (req.url?.startsWith('/token')) {
          tokenCalls++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'bearer-token-1', expires_in: 3600 }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<header ExecutionStatus="0" stare="ok" index_incarcare="1"/>');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        await client.uploadInvoice('<Invoice/>');
        await client.getStatus('1');
        expect(tokenCalls).toBe(1);
      } finally {
        await closeServer(server);
      }
    });

    it('throws a named AnafApiError when ANAF rejects the refresh token', async () => {
      const { server, url } = await startStubServer((_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Invalid client_id x' }));
      });

      try {
        const client = new AnafClient(buildConfig(url, url));
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(AnafApiError);
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(
          /authentication failed \(HTTP 400\)/,
        );
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('uploadInvoice()', () => {
    it('PUTs the raw XML to /upload?standard=UBL&cif={cif} with a Bearer token', async () => {
      let uploadReq: CapturedRequest | undefined;
      const { server, url } = await startAnafStub((req, res) => {
        uploadReq = req;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(
          '<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" ExecutionStatus="0" index_incarcare="5000000001"/>',
        );
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        const result = await client.uploadInvoice('<Invoice>hello</Invoice>');

        expect(uploadReq?.method).toBe('PUT');
        expect(uploadReq?.url).toBe('/upload?standard=UBL&cif=12345678');
        expect(uploadReq?.headers.authorization).toBe('Bearer bearer-token-1');
        expect(uploadReq?.headers['content-type']).toContain('text/plain');
        expect(uploadReq?.body).toBe('<Invoice>hello</Invoice>');
        expect(result.idIncarcare).toBe('5000000001');
      } finally {
        await closeServer(server);
      }
    });

    it("also reads the camelCase spelling, defensively (never observed live — see this file's own header)", async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<header ExecutionStatus="0" indexIncarcare="42"/>');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        const result = await client.uploadInvoice('<Invoice/>');
        expect(result.idIncarcare).toBe('42');
      } finally {
        await closeServer(server);
      }
    });

    it('throws a named AnafApiError on an HTTP-level upload failure', async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal server error');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(AnafApiError);
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(/upload failed \(HTTP 500\)/);
      } finally {
        await closeServer(server);
      }
    });

    // THE HARD-SUCCESS CONTRACT (this task's own mutation #1): an ANAF response with NO usable
    // index_incarcare is a FAILURE, never a silent success — a reference nobody can look up on ANAF's
    // own portal is not a reference at all.
    it('throws when ANAF answers 2xx with NO index_incarcare at all — never invents one', async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(
          '<header ExecutionStatus="1"><Errors errorMessage="XML validation failed: BR-CO-15"/></header>',
        );
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(AnafApiError);
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(/upload rejected/);
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(/BR-CO-15/);
      } finally {
        await closeServer(server);
      }
    });

    it('throws (naming the empty response) when ANAF answers 2xx with an empty/unparseable body', async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow(/empty response/);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('getStatus()', () => {
    it('GETs /stareMesaj?id_incarcare={id} and reads the real XML `stare` attribute', async () => {
      let statusReq: CapturedRequest | undefined;
      const { server, url } = await startAnafStub((req, res) => {
        statusReq = req;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<header stare="ok"/>');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        const result = await client.getStatus('5000000001');

        expect(statusReq?.method).toBe('GET');
        expect(statusReq?.url).toBe('/stareMesaj?id_incarcare=5000000001');
        expect(result.stare).toBe('ok');
        expect(mapAnafStatus(result.stare)).toBe('CLEARED');
      } finally {
        await closeServer(server);
      }
    });

    it('defaults to "in prelucrare" when the response carries no `stare` at all', async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<header/>');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        const result = await client.getStatus('1');
        expect(result.stare).toBe('in prelucrare');
        expect(mapAnafStatus(result.stare)).toBe('PENDING');
      } finally {
        await closeServer(server);
      }
    });

    it("carries the authority's own Errors on a nok", async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<header stare="nok"><Errors errorMessage="Buyer VAT identifier missing"/></header>');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        const result = await client.getStatus('1');
        expect(result.stare).toBe('nok');
        expect(result.errors).toEqual(['Buyer VAT identifier missing']);
        expect(mapAnafStatus(result.stare)).toBe('REJECTED');
      } finally {
        await closeServer(server);
      }
    });

    it('throws a named AnafApiError on an HTTP-level stareMesaj failure — never returns a fake status', async () => {
      const { server, url } = await startAnafStub((_req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      });

      try {
        const client = new AnafClient(buildConfig(url, `${url}/token`));
        await expect(client.getStatus('missing')).rejects.toThrow(AnafApiError);
        await expect(client.getStatus('missing')).rejects.toThrow(/stareMesaj failed \(HTTP 404\)/);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('mapAnafStatus', () => {
    it('maps "ok" (any case) → CLEARED', () => {
      expect(mapAnafStatus('ok')).toBe('CLEARED');
      expect(mapAnafStatus('OK')).toBe('CLEARED');
    });
    it('maps "nok" and any error-flavored stare → REJECTED', () => {
      expect(mapAnafStatus('nok')).toBe('REJECTED');
      expect(mapAnafStatus('NOK')).toBe('REJECTED');
      expect(mapAnafStatus('XML cu erori neprelucrat')).toBe('REJECTED');
    });
    it('maps "in prelucrare" and anything unknown → PENDING, never a guessed terminal outcome', () => {
      expect(mapAnafStatus('in prelucrare')).toBe('PENDING');
      expect(mapAnafStatus('some_new_status')).toBe('PENDING');
    });
  });
});
