import { BUILT_IN_PAYMENT_METHODS } from './built-in';
import {
  buildPaymentMethodRegistry,
  defaultPaymentMethodRegistry,
  PaymentMethodRegistry,
} from './payment-method-registry';
import { PaymentMethodDescriptor } from './types';

function fakeMethod(id: string): PaymentMethodDescriptor {
  return { id, label: id, fields: [], present: () => ({ id, label: id, lines: [] }) };
}

describe('PaymentMethodRegistry', () => {
  it('registers and resolves by id', () => {
    const registry = new PaymentMethodRegistry();
    const method = fakeMethod('acme-wire');
    registry.register(method);

    expect(registry.resolve('acme-wire')).toBe(method);
    expect(registry.list()).toEqual([method]);
  });

  it('refuses a second registration under the SAME id', () => {
    const registry = new PaymentMethodRegistry();
    registry.register(fakeMethod('dup'));
    expect(() => registry.register(fakeMethod('dup'))).toThrow(
      'A payment method for "dup" is already registered.',
    );
  });

  it('resolve() never throws for an unknown id — undefined, the honest "no descriptor" outcome', () => {
    const registry = new PaymentMethodRegistry();
    expect(registry.resolve('card')).toBeUndefined();
    expect(registry.resolve('other')).toBeUndefined();
  });
});

describe('buildPaymentMethodRegistry / defaultPaymentMethodRegistry', () => {
  it('registers exactly the built-in list, in order', () => {
    const registry = buildPaymentMethodRegistry();
    expect(registry.list()).toEqual(BUILT_IN_PAYMENT_METHODS);
  });

  it('the shared singleton resolves every built-in id', () => {
    for (const method of BUILT_IN_PAYMENT_METHODS) {
      expect(defaultPaymentMethodRegistry.resolve(method.id)).toBe(method);
    }
  });
});
