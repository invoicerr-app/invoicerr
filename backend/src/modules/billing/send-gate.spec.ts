import { ForbiddenException } from '@nestjs/common';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { assertCanSend, SUBSCRIPTION_SEND_BLOCKED, TRIAL_SEND_BLOCKED } from './send-gate';

jest.mock('./company-subscription.store');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

describe('assertCanSend', () => {
  afterEach(() => {
    jest.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op when billing is disabled — never even calls the store', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await expect(assertCanSend('company-1')).resolves.toBeUndefined();
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  describe('when billing is enabled', () => {
    beforeEach(() => {
      process.env[BILLING_FLAG_NAME] = 'true';
    });

    it('allows an ACTIVE subscription', async () => {
      getOrCreate.mockResolvedValue({ status: 'ACTIVE' });
      await expect(assertCanSend('company-1')).resolves.toBeUndefined();
    });

    it('blocks a TRIAL subscription with the named TRIAL_SEND_BLOCKED code', async () => {
      getOrCreate.mockResolvedValue({ status: 'TRIAL' });
      const err = await assertCanSend('company-1').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getStatus()).toBe(403);
      expect(err.getResponse()).toMatchObject({ code: TRIAL_SEND_BLOCKED });
    });

    it.each([
      'PAST_DUE',
      'BLOCKED',
      'ZIPPED',
      'DELETED',
    ])('blocks a %s subscription with SUBSCRIPTION_SEND_BLOCKED', async (status) => {
      getOrCreate.mockResolvedValue({ status });
      const err = await assertCanSend('company-1').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: SUBSCRIPTION_SEND_BLOCKED });
    });
  });
});
