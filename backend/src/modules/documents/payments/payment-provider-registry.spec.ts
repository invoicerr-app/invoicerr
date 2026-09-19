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
  it('resolves a registered provider by id', () => {
    const registry = new PaymentProviderRegistry();
    const provider = fakeProvider('stripe');
    registry.register(provider);

    expect(registry.resolve('stripe')).toBe(provider);
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
