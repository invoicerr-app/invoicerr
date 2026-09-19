import { shouldUseRealPaymentClients } from './should-use-real-clients';

describe('shouldUseRealPaymentClients', () => {
  it('NODE_ENV=test, no flag → false (unchanged default: Fake clients)', () => {
    expect(shouldUseRealPaymentClients({ NODE_ENV: 'test' })).toBe(false);
  });

  it('NODE_ENV=test, PAYMENT_PROVIDERS_REAL=1 → true (opt-in to Real clients)', () => {
    expect(shouldUseRealPaymentClients({ NODE_ENV: 'test', PAYMENT_PROVIDERS_REAL: '1' })).toBe(true);
  });

  it('NODE_ENV=production, no flag → true (unchanged default: Real clients)', () => {
    expect(shouldUseRealPaymentClients({ NODE_ENV: 'production' })).toBe(true);
  });

  it('NODE_ENV=production, PAYMENT_PROVIDERS_REAL=1 → true (flag is a no-op outside NODE_ENV=test)', () => {
    expect(shouldUseRealPaymentClients({ NODE_ENV: 'production', PAYMENT_PROVIDERS_REAL: '1' })).toBe(true);
  });
});
