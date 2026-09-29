import { vi } from 'vitest';
import { PaymentProviderRegistry } from './payment-provider-registry';
import { PaymentProvider } from './provider';

function fakeProvider(id: string): PaymentProvider {
  return {
    id,
    createCheckoutSession: vi.fn(),
    parseWebhookEvent: vi.fn(),
  };
}

describe('PaymentProviderRegistry', () => {
  it('resolves a registered provider by id', async () => {
    const registry = new PaymentProviderRegistry();
    const provider = fakeProvider('stripe');
    (provider.createCheckoutSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      providerSessionId: 'cs_1',
      checkoutUrl: 'https://example.test/checkout',
    });
    registry.register(provider);

    // Issue #533: `register()` now wraps `createCheckoutSession` in a demo-mode guard (see that
    // method's own header), so the resolved provider is no longer the SAME object reference — it is
    // functionally equivalent and still delegates to the original outside demo mode.
    const resolved = registry.resolve('stripe');
    expect(resolved).not.toBe(provider);
    expect(resolved?.id).toBe('stripe');
    await expect(
      resolved?.createCheckoutSession(
        {},
        {
          amountMinor: 100,
          currency: 'EUR',
          description: 'x',
          successUrl: 'a',
          cancelUrl: 'b',
          metadata: {},
        },
      ),
    ).resolves.toEqual({ providerSessionId: 'cs_1', checkoutUrl: 'https://example.test/checkout' });
    expect(provider.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('returns undefined (never throws) for an unregistered id', () => {
    const registry = new PaymentProviderRegistry();
    expect(registry.resolve('paypal')).toBeUndefined();
  });

  it('refuses registering the same id twice', () => {
    const registry = new PaymentProviderRegistry();
    registry.register(fakeProvider('stripe'));
    expect(() => registry.register(fakeProvider('stripe'))).toThrow('already registered');
  });

  it('lists every registered id', () => {
    const registry = new PaymentProviderRegistry();
    registry.register(fakeProvider('stripe'));
    expect(registry.list()).toEqual(['stripe']);
  });
});
