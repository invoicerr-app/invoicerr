/**
 * `IopoleClient` against a mocked `fetch`. The real round-trip is `iopole.live.spec.ts`'s job; what
 * this file pins down is the set of behaviours a live run would NOT catch, because the sandbox
 * happens to be well-behaved:
 *   - `customer-id` really is sent on EVERY request, not only at authentication;
 *   - the token expiry is derived from the RESPONSE, never from a compiled-in 3600;
 *   - a response missing `expires_in` is not cached as if it lasted an hour;
 *   - a 401 drops the cached token, so the next call re-authenticates instead of replaying a token
 *     the platform has already refused;
 *   - a 4xx is never retried, and a 5xx is;
 *   - the uploaded file's name carries the extension the platform's own pattern requires.
 * Every one of those is a silent-failure shape, which is exactly the category of bug a green live
 * run proves nothing about.
 */
import { afterEach, beforeEach, vi } from 'vitest';

import { IopoleApiError, IopoleClient, iopoleFileExtensionFor } from './iopole-client';

const CONFIG = {
  apiBaseUrl: 'https://api.ppd.iopole.fr',
  tokenUrl: 'https://auth.ppd.iopole.fr/realms/iopole/protocol/openid-connect/token',
  clientId: 'pdp+iopole@example.test',
  clientSecret: 'secret-1',
  customerId: '00000000-0000-0000-0000-000000000000',
};

/**
 * The token endpoint's real answer shape, with the real measured TTL - see `iopole-client.ts`'s own
 * header, point 2. 1740, never 3600.
 *
 * Always called FRESH per mocked call (`mockImplementation`, never `mockResolvedValue` holding one
 * instance): a `Response` body can only be read once, so a single shared instance makes the second
 * call fail on an already-consumed stream - which reads as a product bug and is not one.
 */
function tokenResponse(body: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ access_token: 'token-1', expires_in: 1740, token_type: 'Bearer', ...body }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('iopoleFileExtensionFor', () => {
  it('maps a PDF mime to .pdf and everything else to .xml', () => {
    expect(iopoleFileExtensionFor('application/pdf')).toBe('pdf');
    expect(iopoleFileExtensionFor('application/xml')).toBe('xml');
    expect(iopoleFileExtensionFor('text/xml')).toBe('xml');
  });
});

describe('IopoleClient - construction', () => {
  // `customer-id` is mandatory on every Iopole call, so a client built without one can do nothing at
  // all. Failing HERE names the cause; failing on the first call leaves a 401/403 to be misread as a
  // credential problem.
  it('refuses to be built without a customerId', () => {
    expect(() => new IopoleClient({ ...CONFIG, customerId: '' })).toThrow(/customerId/);
  });
});

describe('IopoleClient.authenticate', () => {
  it('posts client_credentials to the token URL and returns the access token', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    const client = new IopoleClient(CONFIG);

    await expect(client.authenticate()).resolves.toBe('token-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.tokenUrl);
    expect(init.method).toBe('POST');
    // Never followed automatically - a 30x here would replay this request, client secret included,
    // at whatever the redirect named.
    expect(init.redirect).toBe('manual');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('client_credentials');
    // The client id IS the account's e-mail address - sent verbatim, never normalised. See
    // `iopole-client.ts`'s own header, point 1.
    expect(body.get('client_id')).toBe('pdp+iopole@example.test');
  });

  it('caches the token for the TTL THE RESPONSE GAVE, not a compiled-in hour', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(tokenResponse()));
    const client = new IopoleClient(CONFIG);

    await client.authenticate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still inside the real 1740s window (minus the 60s safety margin): the cached token is reused.
    vi.advanceTimersByTime(1_600_000);
    await client.authenticate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past 1740s - 60s, but WELL INSIDE the 3600s the documentation claims. A client that had
    // hardcoded an hour would still be handing out a token that died here.
    vi.advanceTimersByTime(200_000);
    await client.authenticate();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a token whose response carried no usable expires_in', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(tokenResponse({ expires_in: undefined })));
    const client = new IopoleClient(CONFIG);

    await client.authenticate();
    await client.authenticate();

    // Re-fetched rather than assumed to last an hour - one extra token request is a cost, a token
    // that expired eleven minutes ago is a bug nobody can read from the symptom.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a 200 that carries no access_token rather than caching an unusable one', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ token_type: 'Bearer' })));
    const client = new IopoleClient(CONFIG);

    await expect(client.authenticate()).rejects.toThrow(IopoleApiError);
    await expect(client.authenticate()).rejects.toThrow(/no usable access_token/);
  });

  it('surfaces the platform error_description on a rejected token request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_client', error_description: 'Invalid client credentials' }, 401),
    );
    const client = new IopoleClient(CONFIG);

    await expect(client.authenticate()).rejects.toThrow(/Invalid client credentials/);
  });
});

describe('IopoleClient.request', () => {
  it('sends the customer-id header on EVERY call, not only at authentication', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new IopoleClient(CONFIG);

    await client.request('GET', '/v1/invoice/abc');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.ppd.iopole.fr/v1/invoice/abc');
    expect(init.headers['customer-id']).toBe(CONFIG.customerId);
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.redirect).toBe('manual');
  });

  it('drops the cached token on a 401 so the NEXT call re-authenticates', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ statusMessage: 'Token is missing or invalid' }, 401))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'token-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new IopoleClient(CONFIG);

    await expect(client.request('GET', '/v1/invoice/abc')).rejects.toThrow(/Token is missing or invalid/);
    await client.request('GET', '/v1/invoice/abc');

    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer token-2');
  });

  it('never retries a 4xx - the platform has already judged this exact request', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ message: 'UNKNOWN_INVOICE_FORMAT' }, 400));
    const client = new IopoleClient(CONFIG);

    await expect(client.request('GET', '/v1/invoice/abc')).rejects.toThrow(/UNKNOWN_INVOICE_FORMAT/);
    // One token call + exactly one API call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx and succeeds when the platform recovers', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new IopoleClient(CONFIG, { maxRetries: 1 });

    await expect(client.request('GET', '/v1/invoice/abc')).resolves.toEqual({ ok: true });
  });
});

describe('IopoleClient.sendInvoice', () => {
  it('uploads one multipart part named "file", with a name carrying the extension the platform requires', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ type: 'INVOICE', id: 'uuid-1' }, 201));
    const client = new IopoleClient(CONFIG);

    const created = await client.sendInvoice(Buffer.from('%PDF-1.4'), {
      mime: 'application/pdf',
      fileName: 'INV-2026-0001.pdf',
    });

    expect(created).toEqual({ type: 'INVOICE', id: 'uuid-1' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.ppd.iopole.fr/v1/invoice');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('INV-2026-0001.pdf');
    expect(file.type).toBe('application/pdf');
    // Content-Type is left to fetch so the multipart boundary is the one it actually wrote.
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('falls back to a generated name that still matches the platform pattern', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ type: 'INVOICE', id: 'uuid-1' }, 201));
    const client = new IopoleClient(CONFIG);

    await client.sendInvoice(Buffer.from('<Invoice/>'), { mime: 'application/xml' });

    const form = fetchMock.mock.calls[1][1].body as FormData;
    expect((form.get('file') as File).name).toBe('invoice.xml');
  });
});

describe('IopoleClient.getInvoice / getStatusHistory', () => {
  // The OpenAPI document declares a single object here; the sandbox answers with an array of one.
  // Both shapes accepted, neither guessed - see `getInvoice()`'s own comment.
  it('accepts BOTH shapes the platform has actually been observed returning for getInvoice', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ invoiceId: 'uuid-1' }]))
      .mockResolvedValueOnce(jsonResponse({ invoiceId: 'uuid-1' }));
    const client = new IopoleClient(CONFIG);

    await expect(client.getInvoice('uuid-1')).resolves.toEqual({ invoiceId: 'uuid-1' });
    await expect(client.getInvoice('uuid-1')).resolves.toEqual({ invoiceId: 'uuid-1' });
  });

  it('returns null for an invoice the platform answers about with nothing', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse([]));
    const client = new IopoleClient(CONFIG);

    await expect(client.getInvoice('uuid-1')).resolves.toBeNull();
  });

  it('returns the status history as a plain array', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ status: { code: 'SUBMITTED' } }]));
    const client = new IopoleClient(CONFIG);

    await expect(client.getStatusHistory('uuid-1')).resolves.toEqual([{ status: { code: 'SUBMITTED' } }]);
  });
});
