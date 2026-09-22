import { BILLING_FLAG_NAME, isBillingEnabled } from './billing-flag';

describe('isBillingEnabled', () => {
  it('is false when the flag is entirely unset (the self-hosted default)', () => {
    expect(isBillingEnabled({})).toBe(false);
  });

  it.each(['true', 'True', 'TRUE', '1', '  true  ', ' 1 '])('is true for %j', (value) => {
    expect(isBillingEnabled({ [BILLING_FLAG_NAME]: value })).toBe(true);
  });

  it.each(['false', '0', 'yes', 'on', '', '  '])('is false for %j', (value) => {
    expect(isBillingEnabled({ [BILLING_FLAG_NAME]: value })).toBe(false);
  });

  it('never reads any other env var name', () => {
    expect(isBillingEnabled({ BILLING_ENABLED: 'true', ENABLE_BILLING: 'true' })).toBe(false);
  });
});
