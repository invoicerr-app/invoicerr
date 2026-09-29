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

/** A real CLASS, matching `StripeProvider`/`MollieProvider`/`PayPalProvider`'s own shape: methods
 *  declared on the prototype, not as instance fields, unlike `fakeProvider()` above (a plain object
 *  literal, every member already an own enumerable property). Regression test for issue #533's own
 *  `register()` bug: `{ ...provider, createCheckoutSession: ... }` silently dropped `parseWebhookEvent`
 *  for every real provider (a class instance's prototype methods are not own enumerable properties, so
 *  an object spread never copies them), breaking every provider's webhook endpoint outright, demo mode
 *  or not. Caught by `e2e/cypress/e2e/71-online-payment-providers.cy.ts` failing on `cy.request()`
 *  against Mollie/PayPal's real webhook flow; `fakeProvider()`'s own plain-object shape above never
 *  exercised this because a spread of a plain object copies every property fine. */
class ClassBasedFakeProvider implements PaymentProvider {
  readonly id = 'class-fake';
  async createCheckoutSession(): ReturnType<PaymentProvider['createCheckoutSession']> {
    return { providerSessionId: 'cs_1', checkoutUrl: 'https://example.test' };
  }
  async parseWebhookEvent(): ReturnType<PaymentProvider['parseWebhookEvent']> {
    return { type: 'checkout.completed', providerSessionId: 'cs_1' };
  }
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
    // method's own header), so the resolved provider is no longer the SAME object reference, it is
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

  it('keeps parseWebhookEvent callable on a class-based provider after registration (issue #533)', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new ClassBasedFakeProvider());

    const resolved = registry.resolve('class-fake');
    expect(typeof resolved?.parseWebhookEvent).toBe('function');
    await expect(resolved?.parseWebhookEvent(Buffer.from(''), {}, {})).resolves.toEqual({
      type: 'checkout.completed',
      providerSessionId: 'cs_1',
    });
  });
});
