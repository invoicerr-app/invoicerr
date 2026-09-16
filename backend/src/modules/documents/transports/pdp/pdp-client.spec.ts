/**
 * PDP client unit tests — mocked HTTP layer.
 *
 * Tests OAuth2 authentication, request handling, status mapping, and error handling.
 * No network calls — all fetch() calls are mocked.
 */
import { PdpClient, PdpApiError } from './pdp-client';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockTokenResponse(overrides?: Partial<{ access_token: string; expires_in: number }>): unknown {
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({
      access_token: 'mock-bearer-token',
      token_type: 'Bearer',
      expires_in: 3600,
      ...overrides,
    }),
  };
}

function mockJsonResponse(body: unknown, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => body,
  };
}

function mockTextResponse(body: string, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'text/plain']]),
    text: async () => body,
  };
}

const CLIENT_CONFIG = {
  baseUrl: 'https://api.superpdp.tech',
  clientId: 'test-id',
  clientSecret: 'test-secret',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PdpClient', () => {
  describe('OAuth2', () => {
    it('authenticate() sends client_credentials grant', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      const token = await client.authenticate();

      expect(token).toBe('mock-bearer-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.superpdp.tech/oauth2/token');
      expect(opts!.method).toBe('POST');
      expect(opts!.body).toContain('grant_type=client_credentials');
      expect(opts!.body).toContain('client_id=test-id');
    });

    it('authenticate() caches token until near expiry', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse({ expires_in: 3600 }) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      const t1 = await client.authenticate();
      const t2 = await client.authenticate();

      expect(t1).toBe(t2);
      expect(mockFetch).toHaveBeenCalledTimes(1); // only one HTTP call
    });

    it('authenticate() re-authenticates after token expiry', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse({ expires_in: 0 }) as unknown as Response) // expires immediately
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await client.authenticate();
      await client.authenticate(); // should re-auth

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('authenticate() throws PdpApiError on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ error: 'invalid_client' }, 401) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.authenticate()).rejects.toThrow(PdpApiError);
    });

    it('clearToken() forces re-authentication', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response)
        .mockResolvedValueOnce(mockTokenResponse({ access_token: 'new-token' }) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await client.authenticate();
      client.clearToken();
      const token = await client.authenticate();

      expect(token).toBe('new-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // The measured defect: a 200 OAuth response with no usable `access_token` used to be cast
    // unchecked and CACHED — every call for up to an hour would then silently reuse that same
    // unusable value instead of re-authenticating.
    it('authenticate() refuses a 200 response with no access_token, rather than caching an unusable one', async () => {
      // `mockResolvedValue` (not `Once`): BOTH assertions below make their own `authenticate()` call,
      // and each must independently see the same malformed response — nothing was cached (that is
      // exactly the property under test), so each is a fresh fetch.
      mockFetch.mockResolvedValue(mockTokenResponse({ access_token: undefined }) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.authenticate()).rejects.toThrow(PdpApiError);
      await expect(client.authenticate()).rejects.toThrow(/no usable access_token/);
    });

    it('authenticate() refuses a 200 response with a blank access_token the same way', async () => {
      mockFetch.mockResolvedValue(mockTokenResponse({ access_token: '' }) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.authenticate()).rejects.toThrow(PdpApiError);
    });

    it('a refused (no access_token) authentication never caches anything — the NEXT call re-authenticates too', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse({ access_token: undefined }) as unknown as Response)
        .mockResolvedValueOnce(mockTokenResponse({ access_token: 'recovered-token' }) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.authenticate()).rejects.toThrow(PdpApiError);
      const token = await client.authenticate();

      expect(token).toBe('recovered-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('a 401 on an ordinary request clears the cached token, so the NEXT call re-authenticates', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response) // initial auth
        .mockResolvedValueOnce(mockJsonResponse({ error: 'invalid_token' }, 401) as unknown as Response) // 401 on the real call
        .mockResolvedValueOnce(mockTokenResponse({ access_token: 'fresh-token' }) as unknown as Response) // re-auth
        .mockResolvedValueOnce(mockJsonResponse({ id: 'inv-1' }) as unknown as Response); // succeeds now

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.request('GET', '/v1/invoices/inv-1')).rejects.toThrow(PdpApiError);
      const result = await client.request('GET', '/v1/invoices/inv-1');

      expect(result).toEqual({ id: 'inv-1' });
      // 1 initial auth + 1 failed call + 1 re-auth + 1 successful call
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('SuperPDP proprietary API', () => {
    it('sendInvoice() sends multipart with external_id', async () => {
      // First call: auth
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response);
      // Second call: sendInvoice
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ id: 42, status_code: ['api:uploaded'] }) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      const result = await client.sendInvoice(Buffer.from('%PDF-1.4 test'), { externalId: 'my-ref-123' });

      expect(result.id).toBe(42);
      expect(result.status_code).toContain('api:uploaded');
    });

    it('getInvoice() fetches invoice by id', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response).mockResolvedValueOnce(
        mockJsonResponse({
          id: 42,
          status_code: ['api:uploaded', 'fr:200', 'fr:201'],
          direction: 'out',
        }) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      const result = await client.getInvoice(42);

      expect(result.id).toBe(42);
      expect(result.status_code).toEqual(['api:uploaded', 'fr:200', 'fr:201']);
    });

    it('downloadInvoiceFile() returns raw bytes, never JSON-parsed', async () => {
      const pdfBytes = Buffer.from('%PDF-1.4 fake pdf bytes');
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/pdf']]),
        arrayBuffer: async () =>
          pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
      } as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      const result = await client.downloadInvoiceFile(42);

      expect(result.contentType).toBe('application/pdf');
      expect(result.bytes.toString()).toBe(pdfBytes.toString());
      const [url] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('https://api.superpdp.tech/v1.beta/invoices/42?format=original');
    });

    it('downloadInvoiceFile() throws PdpApiError on a non-OK response, reading the JSON error body', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response)
        .mockResolvedValueOnce(mockJsonResponse({ errorMessage: 'not found' }, 404) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.downloadInvoiceFile(999)).rejects.toThrow(PdpApiError);
    });

    it('getCompany() fetches current company', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response)
        .mockResolvedValueOnce(
          mockJsonResponse({ id: 1, name: 'Test FR', number: '123456789' }) as unknown as Response,
        );

      const client = new PdpClient(CLIENT_CONFIG);
      const result = await client.getCompany();

      expect(result.name).toBe('Test FR');
    });
  });

  describe('AFNOR Flow API', () => {
    it('submitFlow() sends multipart with flowInfo', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response).mockResolvedValueOnce(
        mockJsonResponse({
          flowId: 'uuid-123',
          submittedAt: '2026-06-28T12:00:00Z',
          flowSyntax: 'Factur-X',
          name: 'invoice.pdf',
          flowDirection: 'Out',
          flowType: 'CustomerInvoice',
          updatedAt: '2026-06-28T12:00:00Z',
        }) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      const flow = await client.submitFlow(Buffer.from('%PDF test'), {
        flowSyntax: 'Factur-X',
        name: 'invoice',
        trackingId: 'track-123',
      });

      expect(flow.flowId).toBe('uuid-123');
      expect(flow.flowSyntax).toBe('Factur-X');
    });

    it('searchFlows() posts filter criteria', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response).mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ flowId: 'f1', acknowledgement: { status: 'Ok' } }],
          limit: 10,
          filters: {},
        }) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      const result = await client.searchFlows({ trackingId: 'track-123' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].acknowledgement?.status).toBe('Ok');
    });

    it('getFlow() fetches flow by id', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response).mockResolvedValueOnce(
        mockJsonResponse({
          flowId: 'uuid-123',
          acknowledgement: { status: 'Pending' },
          updatedAt: '2026-06-28T12:00:00Z',
        }) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      const flow = await client.getFlow('uuid-123');

      expect(flow.acknowledgement?.status).toBe('Pending');
    });
  });

  describe('Directory lookup', () => {
    it('lookupDirectoryEntries() fetches entries for SIREN', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse() as unknown as Response).mockResolvedValueOnce(
        mockJsonResponse({
          data: [{ id: 1, addressing_identifier: 'addr-1', platform_type: 'WK' }],
        }) as unknown as Response,
      );

      const client = new PdpClient(CLIENT_CONFIG);
      const entries = await client.lookupDirectoryEntries('123456789');

      expect(entries).toHaveLength(1);
      expect(entries[0].platform_type).toBe('WK');
    });
  });

  describe('Error handling', () => {
    it('throws PdpApiError with response body on 4xx', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response)
        .mockResolvedValueOnce(mockJsonResponse({ errorMessage: 'Invalid XML' }, 422) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG);
      await expect(client.getInvoice(1)).rejects.toThrow(PdpApiError);
    });

    it('retries on 5xx errors', async () => {
      mockFetch
        .mockResolvedValueOnce(mockTokenResponse() as unknown as Response)
        .mockResolvedValueOnce(mockTextResponse('Internal Error', 500) as unknown as Response)
        .mockResolvedValueOnce(mockJsonResponse({ id: 1, status_code: [] }) as unknown as Response);

      const client = new PdpClient(CLIENT_CONFIG, { maxRetries: 1 });
      const result = await client.getInvoice(1);

      expect(result.id).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(3); // auth + retry1 + success
    });
  });
});
