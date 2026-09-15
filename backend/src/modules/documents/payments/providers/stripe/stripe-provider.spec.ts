import { createHmac } from 'node:crypto';

import { PaymentWebhookVerificationError } from '../../provider';
import { StripeProvider } from './stripe-provider';

const CREDENTIALS = { secretKey: 'sk_test_123', webhookSecret: 'whsec_test_456' };

function sign(payload: string, secret: string, timestampSeconds: number): string {
  const hmac = createHmac('sha256', secret).update(`${timestampSeconds}.${payload}`).digest('hex');
  return `t=${timestampSeconds},v1=${hmac}`;
}

function eventPayload(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id: 'evt_1', type, data: { object } });
}

describe('StripeProvider.createCheckoutSession', () => {
  it('delegates to the injected checkout client with the resolved secret key', async () => {
    const checkoutClient = {
      createSession: jest.fn().mockResolvedValue({ providerSessionId: 'cs_1', checkoutUrl: 'https://x' }),
    };
    const provider = new StripeProvider(checkoutClient);

    const input = {
      amountMinor: 1000,
      currency: 'EUR',
      description: 'Invoice X',
      successUrl: 'https://a',
      cancelUrl: 'https://b',
      metadata: {},
    };
    const result = await provider.createCheckoutSession(CREDENTIALS, input);

    expect(result).toEqual({ providerSessionId: 'cs_1', checkoutUrl: 'https://x' });
    expect(checkoutClient.createSession).toHaveBeenCalledWith('sk_test_123', input);
  });

  it('refuses without a network call when credentials are incomplete', async () => {
    const checkoutClient = { createSession: jest.fn() };
    const provider = new StripeProvider(checkoutClient);

    await expect(
      provider.createCheckoutSession(
        { secretKey: 'sk_test_123' },
        {
          amountMinor: 1000,
          currency: 'EUR',
          description: 'x',
          successUrl: 'a',
          cancelUrl: 'b',
          metadata: {},
        },
      ),
    ).rejects.toThrow('not fully configured');
    expect(checkoutClient.createSession).not.toHaveBeenCalled();
  });
});

describe('StripeProvider.parseWebhookEvent', () => {
  const provider = new StripeProvider({ createSession: jest.fn() });

  function headersFor(signature: string): Record<string, string> {
    return { 'stripe-signature': signature };
  }

  it('maps a paid checkout.session.completed event to "checkout.completed"', async () => {
    const payload = eventPayload('checkout.session.completed', { id: 'cs_1', payment_status: 'paid' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, CREDENTIALS.webhookSecret, timestamp);

    const event = await provider.parseWebhookEvent(payload, headersFor(header), CREDENTIALS);
    expect(event).toEqual({ type: 'checkout.completed', providerSessionId: 'cs_1' });
  });

  it('does NOT treat an UNPAID checkout.session.completed as completed', async () => {
    const payload = eventPayload('checkout.session.completed', { id: 'cs_1', payment_status: 'unpaid' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, CREDENTIALS.webhookSecret, timestamp);

    const event = await provider.parseWebhookEvent(payload, headersFor(header), CREDENTIALS);
    expect(event.type).toBe('ignored');
  });

  it('maps checkout.session.expired to "checkout.failed"', async () => {
    const payload = eventPayload('checkout.session.expired', { id: 'cs_1' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, CREDENTIALS.webhookSecret, timestamp);

    const event = await provider.parseWebhookEvent(payload, headersFor(header), CREDENTIALS);
    expect(event).toEqual({ type: 'checkout.failed', providerSessionId: 'cs_1' });
  });

  it('maps an unrelated event type to "ignored", never an error', async () => {
    const payload = eventPayload('customer.created', { id: 'cus_1' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, CREDENTIALS.webhookSecret, timestamp);

    const event = await provider.parseWebhookEvent(payload, headersFor(header), CREDENTIALS);
    expect(event.type).toBe('ignored');
  });

  it('refuses a webhook when this company has no webhookSecret on file', async () => {
    const payload = eventPayload('checkout.session.completed', { id: 'cs_1', payment_status: 'paid' });
    await expect(
      provider.parseWebhookEvent(payload, headersFor('t=1,v1=x'), { secretKey: 'sk_test_123' }),
    ).rejects.toThrow(PaymentWebhookVerificationError);
  });

  it("refuses a signature computed against a DIFFERENT company's webhook secret", async () => {
    const payload = eventPayload('checkout.session.completed', { id: 'cs_1', payment_status: 'paid' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(payload, 'whsec_someone_elses_secret', timestamp);

    await expect(provider.parseWebhookEvent(payload, headersFor(header), CREDENTIALS)).rejects.toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses when the stripe-signature header is missing entirely', async () => {
    const payload = eventPayload('checkout.session.completed', { id: 'cs_1', payment_status: 'paid' });
    await expect(provider.parseWebhookEvent(payload, {}, CREDENTIALS)).rejects.toThrow(
      PaymentWebhookVerificationError,
    );
  });
});
