import { CreateCheckoutSessionInput } from '../../provider';
import { FakePayPalClient, PayPalCredentials, RealPayPalClient } from './paypal-client';

const CREDENTIALS: PayPalCredentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  webhookId: 'WH-1',
  environment: 'sandbox',
};

const INPUT: CreateCheckoutSessionInput = {
  amountMinor: 12050,
  currency: 'EUR',
  description: 'Invoice INV-2026-001',
  successUrl: 'https://app.example.com/portal?payment=success',
  cancelUrl: 'https://app.example.com/portal?payment=cancelled',
  metadata: { companyId: 'company-1', documentId: 'doc-1' },
};

function mockOAuthThenCall(
  oauthResponse: unknown,
  callResponse: { ok: boolean; status: number; json: () => unknown },
) {
  const fetchMock = jest.fn();
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => oauthResponse });
  fetchMock.mockResolvedValueOnce(callResponse);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('RealPayPalClient — OAuth token caching', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetches a token via client_credentials Basic auth and reuses it on a second call', async () => {
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok_1', expires_in: 32400 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'order_1',
        links: [{ rel: 'approve', href: 'https://paypal.com/approve/1' }],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'order_2',
        links: [{ rel: 'approve', href: 'https://paypal.com/approve/2' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RealPayPalClient();
    await client.createOrder(CREDENTIALS, INPUT);
    await client.createOrder(CREDENTIALS, INPUT);

    // Exactly ONE OAuth call for two order creations — the second reuses the cached, still-valid token.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [oauthUrl, oauthInit] = fetchMock.mock.calls[0];
    expect(oauthUrl).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(oauthInit.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    expect(oauthInit.body).toBe('grant_type=client_credentials');
  });

  it('renews the token once it has expired', async () => {
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok_old', expires_in: 1 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'order_1',
        links: [{ rel: 'approve', href: 'https://paypal.com/approve/1' }],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok_new', expires_in: 32400 }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'order_2',
        links: [{ rel: 'approve', href: 'https://paypal.com/approve/2' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RealPayPalClient();
    await client.createOrder(CREDENTIALS, INPUT);
    // The first token had `expires_in: 1` and this client refreshes 60s BEFORE expiry — it is already
    // stale by the time this second call runs, forcing a fresh OAuth round trip.
    await client.createOrder(CREDENTIALS, INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 OAuth calls + 2 order creations
    const secondOrderCall = fetchMock.mock.calls[3];
    expect(secondOrderCall[1].headers.Authorization).toBe('Bearer tok_new');
  });

  it('throws with the OAuth error description on a non-ok token response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error_description: 'Client Authentication failed' }),
    }) as unknown as typeof fetch;

    const client = new RealPayPalClient();
    await expect(client.createOrder(CREDENTIALS, INPUT)).rejects.toThrow('Client Authentication failed');
  });
});

describe('RealPayPalClient.createOrder', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('formats the amount to the CURRENCY-correct decimal count and returns the approve link', async () => {
    const fetchMock = mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'order_1',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve/1' }],
        }),
      },
    );

    const client = new RealPayPalClient();
    const result = await client.createOrder(CREDENTIALS, INPUT);

    expect(result).toEqual({ providerSessionId: 'order_1', checkoutUrl: 'https://paypal.com/approve/1' });
    const orderInit = fetchMock.mock.calls[1][1];
    const body = JSON.parse(orderInit.body as string);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'EUR', value: '120.50' });
    expect(body.application_context.return_url).toBe(INPUT.successUrl);
    expect(body.application_context.cancel_url).toBe(INPUT.cancelUrl);
  });

  it('formats a zero-decimal currency (JPY) without cents', async () => {
    const fetchMock = mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'order_jpy',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve/jpy' }],
        }),
      },
    );

    const client = new RealPayPalClient();
    await client.createOrder(CREDENTIALS, { ...INPUT, amountMinor: 1000, currency: 'JPY' });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'JPY', value: '1000' });
  });

  it('throws when no "approve" link comes back — never invents a checkout URL', async () => {
    mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      { ok: true, status: 201, json: async () => ({ id: 'order_1', links: [] }) },
    );

    const client = new RealPayPalClient();
    await expect(client.createOrder(CREDENTIALS, INPUT)).rejects.toThrow('PayPal order creation failed');
  });
});

describe('RealPayPalClient.captureOrder', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('captures and returns the COMPLETED status', async () => {
    mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      { ok: true, status: 201, json: async () => ({ status: 'COMPLETED' }) },
    );

    const client = new RealPayPalClient();
    await expect(client.captureOrder(CREDENTIALS, 'order_1')).resolves.toEqual({ status: 'COMPLETED' });
  });

  it('IDEMPOTENCE: treats ORDER_ALREADY_CAPTURED as success, never a thrown error', async () => {
    mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      { ok: false, status: 422, json: async () => ({ details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }) },
    );

    const client = new RealPayPalClient();
    await expect(client.captureOrder(CREDENTIALS, 'order_1')).resolves.toEqual({ status: 'COMPLETED' });
  });

  it('throws on a genuine capture failure', async () => {
    mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      { ok: false, status: 422, json: async () => ({ details: [{ issue: 'INSTRUMENT_DECLINED' }] }) },
    );

    const client = new RealPayPalClient();
    await expect(client.captureOrder(CREDENTIALS, 'order_1')).rejects.toThrow('INSTRUMENT_DECLINED');
  });
});

describe('RealPayPalClient.verifyWebhookSignature', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts every transmission header plus the webhookId and returns true on SUCCESS', async () => {
    const fetchMock = mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      { ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }) },
    );

    const client = new RealPayPalClient();
    const result = await client.verifyWebhookSignature(CREDENTIALS, {
      transmissionId: 'tid',
      transmissionTime: 'ttime',
      certUrl: 'https://api.paypal.com/cert',
      authAlgo: 'SHA256withRSA',
      transmissionSig: 'sig',
      webhookEvent: { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    });

    expect(result).toBe(true);
    const verifyInit = fetchMock.mock.calls[1][1];
    const body = JSON.parse(verifyInit.body as string);
    expect(body).toEqual({
      transmission_id: 'tid',
      transmission_time: 'ttime',
      cert_url: 'https://api.paypal.com/cert',
      auth_algo: 'SHA256withRSA',
      transmission_sig: 'sig',
      webhook_id: 'WH-1',
      webhook_event: { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    });
  });

  it('returns false (never throws) on a FAILURE verdict', async () => {
    mockOAuthThenCall(
      { access_token: 'tok', expires_in: 32400 },
      { ok: true, status: 200, json: async () => ({ verification_status: 'FAILURE' }) },
    );

    const client = new RealPayPalClient();
    const result = await client.verifyWebhookSignature(CREDENTIALS, {
      transmissionId: 'tid',
      transmissionTime: 'ttime',
      certUrl: 'https://api.paypal.com/cert',
      authAlgo: 'SHA256withRSA',
      transmissionSig: 'sig',
      webhookEvent: {},
    });
    expect(result).toBe(false);
  });
});

describe('FakePayPalClient', () => {
  it('creates a clearly-fake order and captures it idempotently', async () => {
    const client = new FakePayPalClient();
    const created = await client.createOrder(CREDENTIALS, INPUT);

    expect(created.providerSessionId).toMatch(/^EC-TEST-FAKE-/);
    expect(created.checkoutUrl).toContain('mock-paypal.invalid');

    await expect(client.captureOrder(CREDENTIALS, created.providerSessionId)).resolves.toEqual({
      status: 'COMPLETED',
    });
    // A second capture of the SAME order — the redelivery case — is still a success, never a throw.
    await expect(client.captureOrder(CREDENTIALS, created.providerSessionId)).resolves.toEqual({
      status: 'COMPLETED',
    });
  });

  it('captureOrder REFUSES an order id it never created', async () => {
    const client = new FakePayPalClient();
    await expect(client.captureOrder(CREDENTIALS, 'order_never_created')).rejects.toThrow('HTTP 404');
  });

  it("echoes the caller-supplied successUrl in the mock checkoutUrl — see this class's own header", async () => {
    const client = new FakePayPalClient();
    const created = await client.createOrder(CREDENTIALS, INPUT);

    const returnedSuccessUrl = new URL(created.checkoutUrl).searchParams.get('success_url');
    expect(returnedSuccessUrl).toBe(INPUT.successUrl);
  });

  it('verifyWebhookSignature recognizes an order id THIS instance minted (order-level event)', async () => {
    const client = new FakePayPalClient();
    const created = await client.createOrder(CREDENTIALS, INPUT);

    const result = await client.verifyWebhookSignature(CREDENTIALS, {
      transmissionId: 't',
      transmissionTime: 't',
      certUrl: 'c',
      authAlgo: 'a',
      transmissionSig: 's',
      webhookEvent: { resource: { id: created.providerSessionId } },
    });
    expect(result).toBe(true);
  });

  it('verifyWebhookSignature recognizes it via the CAPTURE-level related_ids.order_id shape too', async () => {
    const client = new FakePayPalClient();
    const created = await client.createOrder(CREDENTIALS, INPUT);

    const result = await client.verifyWebhookSignature(CREDENTIALS, {
      transmissionId: 't',
      transmissionTime: 't',
      certUrl: 'c',
      authAlgo: 'a',
      transmissionSig: 's',
      webhookEvent: {
        resource: {
          id: 'CAPTURE-1',
          supplementary_data: { related_ids: { order_id: created.providerSessionId } },
        },
      },
    });
    expect(result).toBe(true);
  });

  it('verifyWebhookSignature REFUSES an event naming an order id it never created — a forged webhook', async () => {
    const client = new FakePayPalClient();
    const result = await client.verifyWebhookSignature(CREDENTIALS, {
      transmissionId: 't',
      transmissionTime: 't',
      certUrl: 'c',
      authAlgo: 'a',
      transmissionSig: 's',
      webhookEvent: { resource: { id: 'EC-FORGED' } },
    });
    expect(result).toBe(false);
  });
});
