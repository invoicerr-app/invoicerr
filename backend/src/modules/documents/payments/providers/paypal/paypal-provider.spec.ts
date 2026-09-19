import { vi } from 'vitest';
import { CreateCheckoutSessionInput, PaymentWebhookVerificationError } from '../../provider';
import { PayPalProvider } from './paypal-provider';

const CREDENTIALS = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  webhookId: 'WH-1',
  environment: 'sandbox',
};

const INPUT: CreateCheckoutSessionInput = {
  amountMinor: 12000,
  currency: 'EUR',
  description: 'Invoice X',
  successUrl: 'https://a',
  cancelUrl: 'https://b',
  metadata: { companyId: 'company-1', documentId: 'doc-1' },
};

const FULL_HEADERS = {
  'paypal-transmission-id': 'tid',
  'paypal-transmission-time': 'ttime',
  'paypal-cert-url': 'https://api.paypal.com/cert',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-transmission-sig': 'sig',
};

function fakeClient() {
  return { createOrder: vi.fn(), captureOrder: vi.fn(), verifyWebhookSignature: vi.fn() };
}

function eventBody(eventType: string, resource: Record<string, unknown>): string {
  return JSON.stringify({ event_type: eventType, resource });
}

describe('PayPalProvider.createCheckoutSession', () => {
  it('delegates to the injected client with the resolved credentials', async () => {
    const client = fakeClient();
    client.createOrder.mockResolvedValue({
      providerSessionId: 'order_1',
      checkoutUrl: 'https://paypal.com/x',
    });
    const provider = new PayPalProvider(client);

    const result = await provider.createCheckoutSession(CREDENTIALS, INPUT);

    expect(result).toEqual({ providerSessionId: 'order_1', checkoutUrl: 'https://paypal.com/x' });
    expect(client.createOrder).toHaveBeenCalledWith(CREDENTIALS, INPUT);
  });

  it('refuses without a network call when credentials are incomplete', async () => {
    const client = fakeClient();
    const provider = new PayPalProvider(client);

    await expect(provider.createCheckoutSession({ clientId: 'x' }, INPUT)).rejects.toThrow(
      'not fully configured',
    );
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('refuses an unrecognized environment value', async () => {
    const client = fakeClient();
    const provider = new PayPalProvider(client);

    await expect(
      provider.createCheckoutSession({ ...CREDENTIALS, environment: 'production' }, INPUT),
    ).rejects.toThrow('not fully configured');
  });
});

describe('PayPalProvider.parseWebhookEvent', () => {
  it('refuses when transmission headers are missing entirely', async () => {
    const client = fakeClient();
    const provider = new PayPalProvider(client);

    await expect(
      provider.parseWebhookEvent(eventBody('PAYMENT.CAPTURE.COMPLETED', {}), {}, CREDENTIALS),
    ).rejects.toThrow(PaymentWebhookVerificationError);
    expect(client.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('refuses a malformed (non-JSON) body', async () => {
    const client = fakeClient();
    const provider = new PayPalProvider(client);

    await expect(provider.parseWebhookEvent('not-json', FULL_HEADERS, CREDENTIALS)).rejects.toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses without touching the balance when the credentials are missing', async () => {
    const client = fakeClient();
    const provider = new PayPalProvider(client);

    await expect(
      provider.parseWebhookEvent(eventBody('PAYMENT.CAPTURE.COMPLETED', {}), FULL_HEADERS, {}),
    ).rejects.toThrow(PaymentWebhookVerificationError);
    expect(client.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('NEVER ACCEPTED WITHOUT VERIFICATION: a FAILURE verdict from verify-webhook-signature is refused', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(false);
    const provider = new PayPalProvider(client);

    await expect(
      provider.parseWebhookEvent(
        eventBody('PAYMENT.CAPTURE.COMPLETED', { id: 'CAP-1' }),
        FULL_HEADERS,
        CREDENTIALS,
      ),
    ).rejects.toThrow(PaymentWebhookVerificationError);
    expect(client.captureOrder).not.toHaveBeenCalled();
  });

  it('a verification-call failure is refused, never silently ignored', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockRejectedValue(new Error('network error'));
    const provider = new PayPalProvider(client);

    await expect(
      provider.parseWebhookEvent(eventBody('PAYMENT.CAPTURE.COMPLETED', {}), FULL_HEADERS, CREDENTIALS),
    ).rejects.toThrow(PaymentWebhookVerificationError);
  });

  it('CHECKOUT.ORDER.APPROVED triggers a capture and maps to "ignored" — never credits the invoice itself', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(true);
    client.captureOrder.mockResolvedValue({ status: 'COMPLETED' });
    const provider = new PayPalProvider(client);

    const event = await provider.parseWebhookEvent(
      eventBody('CHECKOUT.ORDER.APPROVED', { id: 'order_1' }),
      FULL_HEADERS,
      CREDENTIALS,
    );

    expect(event).toEqual({ type: 'ignored', providerSessionId: 'order_1' });
    expect(client.captureOrder).toHaveBeenCalledWith(CREDENTIALS, 'order_1');
  });

  it('a capture failure triggered by CHECKOUT.ORDER.APPROVED is a genuine throw, not swallowed', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(true);
    client.captureOrder.mockRejectedValue(new Error('PayPal order capture failed (id=order_1): DECLINED'));
    const provider = new PayPalProvider(client);

    await expect(
      provider.parseWebhookEvent(
        eventBody('CHECKOUT.ORDER.APPROVED', { id: 'order_1' }),
        FULL_HEADERS,
        CREDENTIALS,
      ),
    ).rejects.toThrow('PayPal order capture');
  });

  it('PAYMENT.CAPTURE.COMPLETED maps to "checkout.completed", keyed by the ORDER id, not the capture id', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(true);
    const provider = new PayPalProvider(client);

    const event = await provider.parseWebhookEvent(
      eventBody('PAYMENT.CAPTURE.COMPLETED', {
        id: 'CAPTURE-1',
        supplementary_data: { related_ids: { order_id: 'order_1' } },
      }),
      FULL_HEADERS,
      CREDENTIALS,
    );

    expect(event).toEqual({ type: 'checkout.completed', providerSessionId: 'order_1' });
    expect(client.captureOrder).not.toHaveBeenCalled();
  });

  it.each([
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.CAPTURE.DECLINED',
  ])('%s maps to "checkout.failed"', async (eventType) => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(true);
    const provider = new PayPalProvider(client);

    const event = await provider.parseWebhookEvent(
      eventBody(eventType, { id: 'CAPTURE-1', supplementary_data: { related_ids: { order_id: 'order_1' } } }),
      FULL_HEADERS,
      CREDENTIALS,
    );

    expect(event).toEqual({ type: 'checkout.failed', providerSessionId: 'order_1' });
  });

  it('maps an unrelated event type to "ignored", never an error', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(true);
    const provider = new PayPalProvider(client);

    const event = await provider.parseWebhookEvent(
      eventBody('CUSTOMER.DISPUTE.CREATED', {}),
      FULL_HEADERS,
      CREDENTIALS,
    );
    expect(event.type).toBe('ignored');
  });

  it('IDEMPOTENCE: capture is attempted again on a redelivered CHECKOUT.ORDER.APPROVED — the client handles the no-op', async () => {
    const client = fakeClient();
    client.verifyWebhookSignature.mockResolvedValue(true);
    client.captureOrder.mockResolvedValue({ status: 'COMPLETED' }); // FakePayPalClient's own idempotent shape
    const provider = new PayPalProvider(client);

    const body = eventBody('CHECKOUT.ORDER.APPROVED', { id: 'order_1' });
    await provider.parseWebhookEvent(body, FULL_HEADERS, CREDENTIALS);
    await provider.parseWebhookEvent(body, FULL_HEADERS, CREDENTIALS);

    expect(client.captureOrder).toHaveBeenCalledTimes(2);
    expect(client.captureOrder).toHaveBeenNthCalledWith(1, CREDENTIALS, 'order_1');
    expect(client.captureOrder).toHaveBeenNthCalledWith(2, CREDENTIALS, 'order_1');
  });
});
