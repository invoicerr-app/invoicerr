/**
 * `InvopopClient` in isolation, with `fetch` mocked. The real round trip is `invopop.live.spec.ts`'s
 * job, gated on real sandbox credentials. What this file pins is what a mocked test CAN prove and a
 * live one would not notice: that the User-Agent goes out on every single request (see the client's
 * own header, point 2 - without it a Cloudflare edge rule answers 403 to a valid token), that a 409
 * is treated as "already created" rather than an error, and that a Cloudflare block is named as such
 * instead of being reported as a credentials failure.
 *
 * `ALLOW_PRIVATE_OUTBOUND_URLS` is set so the SSRF guard short-circuits before any DNS lookup: these
 * tests must not touch the network at all, not even to resolve a hostname.
 */
import { vi } from 'vitest';

import { INVOPOP_USER_AGENT, InvopopApiError, InvopopClient } from './invopop-client';

const API_KEY = 'test-token-not-a-real-key';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('InvopopClient', () => {
  const fetchMock = vi.fn();
  let previousAllowPrivate: string | undefined;

  beforeAll(() => {
    previousAllowPrivate = process.env.ALLOW_PRIVATE_OUTBOUND_URLS;
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
  });

  afterAll(() => {
    if (previousAllowPrivate === undefined) delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS;
    else process.env.ALLOW_PRIVATE_OUTBOUND_URLS = previousAllowPrivate;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client() {
    return new InvopopClient({ apiKey: API_KEY });
  }

  it('sends the bearer token AND an explicit User-Agent on every request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ping: 'pong' }));
    await client().ping();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['User-Agent']).toBe(INVOPOP_USER_AGENT);
    // Never auto-followed: a validated host can still 30x this same request at an internal address.
    expect(init.redirect).toBe('manual');
  });

  it('defaults to the one host that serves every workspace, sandbox or live', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ping: 'pong' }));
    await client().ping();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.invopop.com/utils/v1/ping');
  });

  it('reads the sandbox flag off the workspace - the only thing that tells test from live', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'ws-1', name: 'Invoicerr', sandbox: true }));
    await expect(client().getWorkspace()).resolves.toMatchObject({ sandbox: true });
  });

  it('wraps the document in `data` when creating a silo entry', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'entry-1' }));
    await client().putSiloEntry('entry-1', { $schema: 'x', code: 'INV-1' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.invopop.com/silo/v1/entries/entry-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ data: { $schema: 'x', code: 'INV-1' } });
  });

  it('treats a 409 on an entry as "already created" and re-reads it instead of failing', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(409, { key: 'conflict', message: 'entry already exists with same id' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: 'entry-1', signed: true }));

    // This is what makes a BullMQ retry safe: the same invoice is never deposited twice.
    await expect(client().putSiloEntry('entry-1', {})).resolves.toMatchObject({ id: 'entry-1' });
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
  });

  it('treats a 409 on a job the same way', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { key: 'conflict' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'job-1', status: 'OK' }));

    await expect(
      client().putJob('job-1', { workflowId: 'wf-1', siloEntryId: 'entry-1' }),
    ).resolves.toMatchObject({ id: 'job-1' });
  });

  it('passes the wait window on the job URL, and omits it when there is none', async () => {
    // A fresh Response per call: a `Response` body can only be read once, so a single shared instance
    // would fail the second call with "Body is unusable".
    fetchMock.mockImplementation(async () => jsonResponse(200, { id: 'job-1' }));
    const c = client();

    await c.putJob('job-1', { workflowId: 'wf-1', siloEntryId: 'entry-1', waitSeconds: 30 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.invopop.com/transform/v1/jobs/job-1?wait=30');

    await c.putJob('job-2', { workflowId: 'wf-1', siloEntryId: 'entry-1' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.invopop.com/transform/v1/jobs/job-2');
  });

  it('names a Cloudflare 403 as a BLOCKED CLIENT, never as a rejected token', async () => {
    fetchMock.mockResolvedValue(textResponse(403, 'error code: 1010'));
    await expect(client().ping()).rejects.toThrow(/BLOCKED CLIENT/);
  });

  it('surfaces GOBL validation faults verbatim - the codes are what an operator searches for', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        key: 'validation',
        faults: [
          {
            code: 'GOBL-FR-TAX-IDENTITY-01',
            message: 'invalid French VAT identity code format or checksum',
          },
        ],
      }),
    );
    await expect(client().putSiloEntry('entry-1', {})).rejects.toThrow(/GOBL-FR-TAX-IDENTITY-01/);
  });

  it('refuses a private base URL outright', async () => {
    // The guard is what stops a tenant pointing this shared backend at an internal address; the
    // escape hatch above is disabled for this one test so the real check runs.
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '0';
    const local = new InvopopClient({ baseUrl: 'http://127.0.0.1:8080', apiKey: API_KEY });
    await expect(local.ping()).rejects.toBeInstanceOf(InvopopApiError);
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
  });
});
