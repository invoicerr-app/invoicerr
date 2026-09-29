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

// Issue #533: the demo never asks to pay, whatever the billing flag says in that same environment.
describe('isBillingEnabled: DEMO_MODE overrides it outright (issue #533)', () => {
  it('is false when DEMO_MODE is on, even though the billing flag is ALSO on', () => {
    expect(isBillingEnabled({ DEMO_MODE: 'true', [BILLING_FLAG_NAME]: 'true' })).toBe(false);
  });

  it('is false when DEMO_MODE is on and the billing flag is unset', () => {
    expect(isBillingEnabled({ DEMO_MODE: 'true' })).toBe(false);
  });

  it('the billing flag alone (DEMO_MODE unset) behaves exactly as before, no regression', () => {
    expect(isBillingEnabled({ [BILLING_FLAG_NAME]: 'true' })).toBe(true);
  });

  it('DEMO_MODE=false does not itself disable billing', () => {
    expect(isBillingEnabled({ DEMO_MODE: 'false', [BILLING_FLAG_NAME]: 'true' })).toBe(true);
  });
});
