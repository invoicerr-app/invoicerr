/**
 * `acube-client.ts` in isolation - the HTTP layer is mocked, no network call is made. What the REAL
 * wire does is proven by `acube.live.spec.ts` against the real sandbox; this file proves the
 * decisions around it that a live run would never exercise on a good day: the token cache and its
 * renewal margin, the refusal to cache an unusable token, the 401 self-heal, and the fact that the
 * environment is a HOST choice rather than a request parameter.
 */
import { vi, type MockedFunction } from 'vitest';

import { AcubeApiError, AcubeClient } from './acube-client';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch as unknown as typeof fetch;

/** An RS256-shaped token is never verified by this client - only its `exp` claim is read - so a
 *  hand-built, unsigned one is the honest fixture here: signing it would suggest this code checks a
 *  signature it does not check. */
function tokenWithExpiry(secondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }),
  ).toString('base64url');
  return `${header}.${payload}.signature-not-verified-by-this-client`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => body,
  } as unknown as Response;
}

const CONFIG = {
  email: 'account@example.test',
  password: 'generated-password',
  environment: 'sandbox' as const,
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('AcubeClient', () => {
  describe('the environment is a HOST, not a request parameter', () => {
    it('resolves the sandbox jurisdiction host', () => {
      expect(new AcubeClient(CONFIG).getBaseUrl()).toBe('https://it-sandbox.api.acubeapi.com');
    });

    it('resolves the production jurisdiction host', () => {
      expect(new AcubeClient({ ...CONFIG, environment: 'production' }).getBaseUrl()).toBe(
        'https://it.api.acubeapi.com',
      );
    });
  });

  describe('authenticate()', () => {
    it('exchanges e-mail + password against the common login host and returns the token', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }));

      const token = await new AcubeClient(CONFIG).authenticate();

      expect(token).toContain('.');
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://common.api.acubeapi.com/login');
      expect(init.method).toBe('POST');
      // The environment travels in the BODY for the login, and in the HOST for everything after -
      // see the client's own header, both halves observed live.
      expect(JSON.parse(init.body as string)).toEqual({
        email: 'account@example.test',
        password: 'generated-password',
        environment: 'sandbox',
      });
      // Never followed automatically: this request carries the account's own password.
      expect(init.redirect).toBe('manual');
    });

    it('caches the token and does not re-authenticate while it is still comfortably valid', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }));
      const client = new AcubeClient(CONFIG);

      await client.authenticate();
      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('re-authenticates rather than hand out a token inside the renewal margin', async () => {
      // 30s left, margin is 60s - a token that would expire mid-flight is never handed out.
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(30) }))
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }));
      const client = new AcubeClient(CONFIG);

      await client.authenticate();
      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('refuses a 200 that carries no usable token, rather than cache an empty value', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ token: '' }));

      await expect(new AcubeClient(CONFIG).authenticate()).rejects.toThrow(AcubeApiError);
      await expect(new AcubeClient(CONFIG).authenticate()).rejects.toThrow(/no usable token/);
    });

    it("surfaces the platform's own explanation on a refusal, not a bare status code", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ code: 401, message: 'Invalid credentials.' }, 401));

      await expect(new AcubeClient(CONFIG).authenticate()).rejects.toThrow(/Invalid credentials/);
    });
  });

  describe('sendInvoice()', () => {
    it('deposits the XML as application/xml and returns the uuid the platform answered with', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }))
        .mockResolvedValueOnce(jsonResponse({ uuid: 'deadbeef-0000-4000-8000-000000000000' }, 202));

      const result = await new AcubeClient(CONFIG).sendInvoice(Buffer.from('<FatturaElettronica/>'));

      expect(result.uuid).toBe('deadbeef-0000-4000-8000-000000000000');
      const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('https://it-sandbox.api.acubeapi.com/invoices');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/xml');
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
      expect(init.body).toBe('<FatturaElettronica/>');
    });

    it('never swallows a 4xx into a retry loop - the platform already judged this request', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }))
        .mockResolvedValueOnce(jsonResponse({ detail: 'invoice number already used' }, 400));

      await expect(new AcubeClient(CONFIG).sendInvoice(Buffer.from('<x/>'))).rejects.toThrow(
        /invoice number already used/,
      );
      // login + the one refused POST, never a second attempt.
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('drops the cached token on a 401 so the NEXT call re-authenticates instead of repeating it', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }))
        .mockResolvedValueOnce(jsonResponse({ code: 401, message: 'Invalid JWT Token' }, 401))
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }))
        .mockResolvedValueOnce(jsonResponse({ uuid: 'second-try-uuid' }, 202));

      const client = new AcubeClient(CONFIG);
      await expect(client.sendInvoice(Buffer.from('<x/>'))).rejects.toThrow(/Invalid JWT Token/);
      const result = await client.sendInvoice(Buffer.from('<x/>'));

      expect(result.uuid).toBe('second-try-uuid');
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('retries a 5xx, then succeeds - a server-side hiccup is not the platform judging the document', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }))
        .mockResolvedValueOnce(textResponse('<html>Bad Gateway</html>', 502))
        .mockResolvedValueOnce(jsonResponse({ uuid: 'after-retry-uuid' }, 202));

      const result = await new AcubeClient(CONFIG, { maxRetries: 2 }).sendInvoice(Buffer.from('<x/>'));

      expect(result.uuid).toBe('after-retry-uuid');
    }, 10_000);
  });

  describe('getInvoice()', () => {
    it('reads one deposit back by uuid, url-encoded', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: tokenWithExpiry(86_400) }))
        .mockResolvedValueOnce(jsonResponse({ uuid: 'abc', marking: 'waiting' }));

      const invoice = await new AcubeClient(CONFIG).getInvoice('abc/def');

      expect(invoice.marking).toBe('waiting');
      expect(mockFetch.mock.calls[1][0]).toBe('https://it-sandbox.api.acubeapi.com/invoices/abc%2Fdef');
    });
  });
});
