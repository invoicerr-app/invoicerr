import { CreateCheckoutSessionInput } from '../../provider';
import { FakeStripeCheckoutClient, RealStripeCheckoutClient } from './stripe-checkout-client';

const INPUT: CreateCheckoutSessionInput = {
  amountMinor: 12000,
  currency: 'EUR',
  description: 'Invoice INV-2026-001',
  successUrl: 'https://app.example.com/portal?payment=success',
  cancelUrl: 'https://app.example.com/portal?payment=cancelled',
  metadata: { companyId: 'company-1', documentId: 'doc-1' },
};

describe('RealStripeCheckoutClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts a form-encoded body with a bearer secret key and returns the session id/url', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/pay/cs_test_abc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new RealStripeCheckoutClient();
    const result = await client.createSession('sk_test_123', INPUT);

    expect(result).toEqual({
      providerSessionId: 'cs_test_abc',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_abc',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.headers.Authorization).toBe('Bearer sk_test_123');
    const body = init.body as string;
    expect(body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=12000');
    expect(body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=eur');
    expect(body).toContain('metadata%5BdocumentId%5D=doc-1');
  });

  it('throws with the provider-reported message on a non-ok response — never invents a session id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key provided' } }),
    }) as unknown as typeof fetch;

    const client = new RealStripeCheckoutClient();
    await expect(client.createSession('sk_bad', INPUT)).rejects.toThrow('Invalid API Key provided');
  });

  it('throws when the response carries no usable id/url even though it answered ok — hard-success contract', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const client = new RealStripeCheckoutClient();
    await expect(client.createSession('sk_test_123', INPUT)).rejects.toThrow(
      'Stripe checkout session creation failed',
    );
  });
});

describe('FakeStripeCheckoutClient', () => {
  it('never calls the network and returns a clearly-fake, deterministic-shape session', async () => {
    const client = new FakeStripeCheckoutClient();
    const result = await client.createSession('sk_test_whatever', INPUT);

    expect(result.providerSessionId).toMatch(/^cs_test_fake_/);
    expect(result.checkoutUrl).toContain('mock-stripe.invalid');
    expect(result.checkoutUrl).toContain(result.providerSessionId);
  });

  it('returns a DIFFERENT session id on every call — never a fixed fixture two invoices could collide on', async () => {
    const client = new FakeStripeCheckoutClient();
    const first = await client.createSession('sk', INPUT);
    const second = await client.createSession('sk', INPUT);
    expect(first.providerSessionId).not.toBe(second.providerSessionId);
  });

  it(
    'echoes the caller-supplied successUrl in the mock checkoutUrl — the only offline way to prove ' +
      "which return URL a session was actually opened with (see this class's own header)",
    async () => {
      const client = new FakeStripeCheckoutClient();
      const result = await client.createSession('sk_test_whatever', INPUT);

      const returnedSuccessUrl = new URL(result.checkoutUrl).searchParams.get('success_url');
      expect(returnedSuccessUrl).toBe(INPUT.successUrl);
    },
  );
});
