import { vi, type Mock } from 'vitest';

import { ForbiddenException } from '@nestjs/common';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { assertCompanyWritable, COMPANY_BLOCKED } from './write-gate';

vi.mock('./company-subscription.store');

const getOrCreate = getOrCreateCompanySubscription as Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

describe('assertCompanyWritable', () => {
  afterEach(() => {
    vi.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op when billing is disabled — never even calls the store', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await expect(assertCompanyWritable('company-1')).resolves.toBeUndefined();
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  describe('when billing is enabled', () => {
    beforeEach(() => {
      process.env[BILLING_FLAG_NAME] = 'true';
    });

    it.each(['TRIAL', 'ACTIVE', 'PAST_DUE'])('allows a %s subscription', async (status) => {
      getOrCreate.mockResolvedValue({ status });
      await expect(assertCompanyWritable('company-1')).resolves.toBeUndefined();
    });

    it.each([
      'BLOCKED',
      'ZIPPED',
    ])('refuses a %s subscription with the named COMPANY_BLOCKED code, 403', async (status) => {
      getOrCreate.mockResolvedValue({ status });
      const err = await assertCompanyWritable('company-1').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getStatus()).toBe(403);
      expect(err.getResponse()).toMatchObject({ code: COMPANY_BLOCKED });
    });
  });
});
