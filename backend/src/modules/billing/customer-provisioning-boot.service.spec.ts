import { BillingCustomerProvisioningBootService } from './customer-provisioning-boot.service';
import { reconcileMissingCompanyCustomers } from './customer-provisioning';

jest.mock('./customer-provisioning');

const reconcile = reconcileMissingCompanyCustomers as jest.Mock;

describe('BillingCustomerProvisioningBootService', () => {
  afterEach(() => jest.resetAllMocks());

  it('runs the reconciliation once and never throws on success', async () => {
    reconcile.mockResolvedValue({ total: 3, alreadyExisted: 1, created: 2, emailTaken: 0, failed: 0 });
    const service = new BillingCustomerProvisioningBootService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('never throws out of boot when the reconciliation itself fails', async () => {
    reconcile.mockRejectedValue(new Error('DB unreachable'));
    const service = new BillingCustomerProvisioningBootService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
