import { vi } from 'vitest';
import { CreateCheckoutSessionInput, PaymentWebhookVerificationError } from '../../provider';
import { MollieProvider } from './mollie-provider';

const INPUT: CreateCheckoutSessionInput = {
  amountMinor: 12000,
  currency: 'EUR',
  description: 'Invoice X',
  successUrl: 'https://a',
  cancelUrl: 'https://b',
  metadata: { companyId: 'company-1', documentId: 'doc-1' },
};

function fakeClient() {
  return { createPayment: vi.fn(), getPayment: vi.fn() };
}

describe('MollieProvider.createCheckoutSession', () => {
  it('delegates to the injected client with the resolved apiKey and a company-scoped webhookUrl', async () => {
    const client = fakeClient();
    client.createPayment.mockResolvedValue({
      providerSessionId: 'tr_1',
      checkoutUrl: 'https://mollie.com/x',
    });
    const provider = new MollieProvider(client);

    const result = await provider.createCheckoutSession({ apiKey: 'test_key' }, INPUT);

    expect(result).toEqual({ providerSessionId: 'tr_1', checkoutUrl: 'https://mollie.com/x' });
    expect(client.createPayment).toHaveBeenCalledWith(
      'test_key',
      INPUT,
      expect.stringContaining('/api/public/payments/mollie/company-1/webhook'),
    );
  });

  it('refuses without a network call when credentials are incomplete', async () => {
    const client = fakeClient();
    const provider = new MollieProvider(client);

    await expect(provider.createCheckoutSession({}, INPUT)).rejects.toThrow('not fully configured');
    expect(client.createPayment).not.toHaveBeenCalled();
  });

  it('refuses when the session metadata carries no companyId (defensive — unreachable in practice)', async () => {
    const client = fakeClient();
    const provider = new MollieProvider(client);

    await expect(
      provider.createCheckoutSession({ apiKey: 'test_key' }, { ...INPUT, metadata: {} }),
    ).rejects.toThrow('companyId');
    expect(client.createPayment).not.toHaveBeenCalled();
  });

  describe('webhookUrlFor — BACKEND_PUBLIC_URL vs. APP_URL (backend-public-url.ts)', () => {
    const originalAppUrl = process.env.APP_URL;
    const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;

    afterEach(() => {
      process.env.APP_URL = originalAppUrl;
      process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
    });

    it('builds the webhook URL off APP_URL when BACKEND_PUBLIC_URL is unset', async () => {
      delete process.env.BACKEND_PUBLIC_URL;
      process.env.APP_URL = 'http://localhost:5173';
      const client = fakeClient();
      client.createPayment.mockResolvedValue({
        providerSessionId: 'tr_1',
        checkoutUrl: 'https://mollie.com/x',
      });
      const provider = new MollieProvider(client);

      await provider.createCheckoutSession({ apiKey: 'test_key' }, INPUT);

      expect(client.createPayment).toHaveBeenCalledWith(
        'test_key',
        INPUT,
        'http://localhost:5173/api/public/payments/mollie/company-1/webhook',
      );
    });

    it('builds the webhook URL off BACKEND_PUBLIC_URL when set — never a browser-facing tunnel-unaware APP_URL', async () => {
      process.env.APP_URL = 'http://localhost:5173';
      process.env.BACKEND_PUBLIC_URL = 'https://tunnel.example.com';
      const client = fakeClient();
      client.createPayment.mockResolvedValue({
        providerSessionId: 'tr_1',
        checkoutUrl: 'https://mollie.com/x',
      });
      const provider = new MollieProvider(client);

      await provider.createCheckoutSession({ apiKey: 'test_key' }, INPUT);

      expect(client.createPayment).toHaveBeenCalledWith(
        'test_key',
        INPUT,
        'https://tunnel.example.com/api/public/payments/mollie/company-1/webhook',
      );
    });
  });
});

describe('MollieProvider.parseWebhookEvent', () => {
  it('maps a "paid" re-fetched payment to "checkout.completed"', async () => {
    const client = fakeClient();
    client.getPayment.mockResolvedValue({ status: 'paid' });
    const provider = new MollieProvider(client);

    const event = await provider.parseWebhookEvent('id=tr_1', {}, { apiKey: 'test_key' });

    expect(event).toEqual({ type: 'checkout.completed', providerSessionId: 'tr_1' });
    expect(client.getPayment).toHaveBeenCalledWith('test_key', 'tr_1');
  });

  it.each([
    'failed',
    'canceled',
    'expired',
  ])('maps a "%s" re-fetched payment to "checkout.failed"', async (status) => {
    const client = fakeClient();
    client.getPayment.mockResolvedValue({ status });
    const provider = new MollieProvider(client);

    const event = await provider.parseWebhookEvent('id=tr_1', {}, { apiKey: 'test_key' });
    expect(event).toEqual({ type: 'checkout.failed', providerSessionId: 'tr_1' });
  });

  it.each(['open', 'pending', 'authorized'])('maps an in-flight "%s" status to "ignored"', async (status) => {
    const client = fakeClient();
    client.getPayment.mockResolvedValue({ status });
    const provider = new MollieProvider(client);

    const event = await provider.parseWebhookEvent('id=tr_1', {}, { apiKey: 'test_key' });
    expect(event.type).toBe('ignored');
  });

  it('refuses a webhook when this company has no apiKey on file — never calls getPayment', async () => {
    const client = fakeClient();
    const provider = new MollieProvider(client);

    await expect(provider.parseWebhookEvent('id=tr_1', {}, {})).rejects.toThrow(
      PaymentWebhookVerificationError,
    );
    expect(client.getPayment).not.toHaveBeenCalled();
  });

  it('refuses a malformed body with no "id" field', async () => {
    const client = fakeClient();
    const provider = new MollieProvider(client);

    await expect(provider.parseWebhookEvent('not-a-form-body', {}, { apiKey: 'k' })).rejects.toThrow(
      PaymentWebhookVerificationError,
    );
    expect(client.getPayment).not.toHaveBeenCalled();
  });

  it('THE VERIFICATION: refuses when the re-fetch itself fails (foreign/unknown payment id) — never partially trusted', async () => {
    const client = fakeClient();
    client.getPayment.mockRejectedValue(
      new Error('Mollie payment re-fetch failed (id=tr_1): HTTP 404 (not found)'),
    );
    const provider = new MollieProvider(client);

    await expect(provider.parseWebhookEvent('id=tr_1', {}, { apiKey: 'test_key' })).rejects.toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('IDEMPOTENCE at the provider level: two identical webhook deliveries both re-verify and both map identically', async () => {
    const client = fakeClient();
    client.getPayment.mockResolvedValue({ status: 'paid' });
    const provider = new MollieProvider(client);

    const first = await provider.parseWebhookEvent('id=tr_1', {}, { apiKey: 'test_key' });
    const second = await provider.parseWebhookEvent('id=tr_1', {}, { apiKey: 'test_key' });

    // The provider itself has no notion of "already processed" — that guard lives one layer up
    // (`payment-sessions.persistence.ts#claimSessionForCompletion`'s own atomic PENDING→COMPLETED
    // claim, proven in `payment-sessions.service.spec.ts`). What THIS level must guarantee is that a
    // replay maps to the exact same event, never a different one depending on call order.
    expect(first).toEqual(second);
    expect(client.getPayment).toHaveBeenCalledTimes(2);
  });
});
