import { NotFoundException } from '@nestjs/common';

import { BILLING_FLAG_NAME } from '@/modules/billing/billing-flag';
import { InstanceResetSaasGuard } from './instance-reset-saas.guard';

describe('InstanceResetSaasGuard', () => {
  const originalBillingFlag = process.env[BILLING_FLAG_NAME];

  afterEach(() => {
    if (originalBillingFlag === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = originalBillingFlag;
  });

  it('lets the request through when billing is not enabled (self-hosted)', () => {
    delete process.env[BILLING_FLAG_NAME];
    expect(new InstanceResetSaasGuard().canActivate()).toBe(true);
  });

  it('masks the route as 404 when billing is enabled (SaaS)', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    expect(() => new InstanceResetSaasGuard().canActivate()).toThrow(NotFoundException);
  });
});
