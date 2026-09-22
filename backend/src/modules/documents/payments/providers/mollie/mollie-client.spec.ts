import { vi } from 'vitest';
import { CreateCheckoutSessionInput } from '../../provider';
import { FakeMollieClient, RealMollieClient } from './mollie-client';

const INPUT: CreateCheckoutSessionInput = {
  amountMinor: 12050,
  currency: 'EUR',
  description: 'Invoice INV-2026-001',
  successUrl: 'https://app.example.com/portal?payment=success',
  cancelUrl: 'https://app.example.com/portal?payment=cancelled',
  metadata: { companyId: 'company-1', documentId: 'doc-1' },
};
const WEBHOOK_URL = 'https://app.example.com/api/public/payments/mollie/company-1/webhook';

describe('RealMollieClient.createPayment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts a JSON body with a two-decimal amount string and returns the payment id/checkout url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'tr_abc', _links: { checkout: { href: 'https://mollie.com/checkout/abc' } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RealMollieClient();
    const result = await client.createPayment('test_apikey', INPUT, WEBHOOK_URL);

    expect(result).toEqual({ providerSessionId: 'tr_abc', checkoutUrl: 'https://mollie.com/checkout/abc' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mollie.com/v2/payments');
    expect(init.headers.Authorization).toBe('Bearer test_apikey');
    const body = JSON.parse(init.body as string);
    expect(body.amount).toEqual({ currency: 'EUR', value: '120.50' });
    expect(body.redirectUrl).toBe(INPUT.successUrl);
    expect(body.webhookUrl).toBe(WEBHOOK_URL);
    expect(body.metadata).toEqual(INPUT.metadata);
    // Mollie has no `cancelUrl` field at all — see `mollie-client.ts`'s own header.
    expect(body.cancelUrl).toBeUndefined();
  });

  it('always sends exactly two decimals, even for a zero-decimal currency like JPY', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'tr_jpy', _links: { checkout: { href: 'https://mollie.com/checkout/jpy' } } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RealMollieClient();
    await client.createPayment('test_apikey', { ...INPUT, amountMinor: 1000, currency: 'JPY' }, WEBHOOK_URL);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.amount).toEqual({ currency: 'JPY', value: '1000.00' });
  });

  it('throws with the provider-reported detail on a non-ok response — never invents a payment id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Missing authentication' }),
    }) as unknown as typeof fetch;

    const client = new RealMollieClient();
    await expect(client.createPayment('bad_key', INPUT, WEBHOOK_URL)).rejects.toThrow(
      'Mollie payment creation failed: Missing authentication',
    );
  });

  it('throws when the response has no usable id/checkout link even though it answered ok', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: async () => ({}) }) as unknown as typeof fetch;

    const client = new RealMollieClient();
    await expect(client.createPayment('test_apikey', INPUT, WEBHOOK_URL)).rejects.toThrow(
      'Mollie payment creation failed',
    );
  });
});

describe('RealMollieClient.getPayment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GETs the payment with a bearer key and returns its status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'paid' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RealMollieClient();
    const result = await client.getPayment('test_apikey', 'tr_abc');

    expect(result).toEqual({ status: 'paid' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mollie.com/v2/payments/tr_abc');
    expect(init.headers.Authorization).toBe('Bearer test_apikey');
  });

  it('throws on a 404 (payment id not owned by this API key) — never reports a fabricated status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'No payment exists with token tr_foreign.' }),
    }) as unknown as typeof fetch;

    const client = new RealMollieClient();
    await expect(client.getPayment('test_apikey', 'tr_foreign')).rejects.toThrow(
      'Mollie payment re-fetch failed (id=tr_foreign): No payment exists with token tr_foreign.',
    );
  });
});

describe('FakeMollieClient', () => {
  it('never calls the network and returns a clearly-fake, deterministic-shape payment', async () => {
    const client = new FakeMollieClient();
    const result = await client.createPayment('whatever', INPUT, WEBHOOK_URL);

    expect(result.providerSessionId).toMatch(/^tr_test_fake_/);
    expect(result.checkoutUrl).toContain('mock-mollie.invalid');
    expect(result.checkoutUrl).toContain(result.providerSessionId);
  });

  it('returns a DIFFERENT payment id on every call', async () => {
    const client = new FakeMollieClient();
    const first = await client.createPayment('k', INPUT, WEBHOOK_URL);
    const second = await client.createPayment('k', INPUT, WEBHOOK_URL);
    expect(first.providerSessionId).not.toBe(second.providerSessionId);
  });

  it('getPayment reports "paid" for an id it created itself', async () => {
    const client = new FakeMollieClient();
    const { providerSessionId } = await client.createPayment('k', INPUT, WEBHOOK_URL);

    await expect(client.getPayment('k', providerSessionId)).resolves.toEqual({ status: 'paid' });
  });

  it('getPayment REFUSES an id it never created — the same shape a foreign-account 404 would take', async () => {
    const client = new FakeMollieClient();
    await expect(client.getPayment('k', 'tr_never_created')).rejects.toThrow('HTTP 404');
  });

  it("echoes the caller-supplied successUrl in the mock checkoutUrl — see this class's own header", async () => {
    const client = new FakeMollieClient();
    const result = await client.createPayment('whatever', INPUT, WEBHOOK_URL);

    const returnedSuccessUrl = new URL(result.checkoutUrl).searchParams.get('success_url');
    expect(returnedSuccessUrl).toBe(INPUT.successUrl);
  });
});
