import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { CustomerSyncClient, syncPolarCustomerOnCompanyChange } from './customer-sync';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { companySubscription: { updateMany: jest.fn() } },
}));

const updateMany = prisma.companySubscription.updateMany as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

function fakeClient(updateExternal = jest.fn().mockResolvedValue({})): CustomerSyncClient {
  return { customers: { updateExternal } };
}

describe('syncPolarCustomerOnCompanyChange', () => {
  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
    updateMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    jest.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it("a company renamed or with a changed billing email pushes name/email to its Polar customer, in the same call as the application's own write", async () => {
    const updateExternal = jest.fn().mockResolvedValue({});
    const client = fakeClient(updateExternal);

    await syncPolarCustomerOnCompanyChange(
      'company-1',
      { name: 'Acme Renamed', email: 'contact@acme.test', billingEmail: null },
      client,
    );

    expect(updateExternal).toHaveBeenCalledWith({
      externalId: 'company-1',
      customerUpdateExternalID: { name: 'Acme Renamed', email: 'contact@acme.test' },
    });
  });

  it('prefers billingEmail over the contact email, same precedence as checkout', async () => {
    const updateExternal = jest.fn().mockResolvedValue({});
    const client = fakeClient(updateExternal);

    await syncPolarCustomerOnCompanyChange(
      'company-1',
      { name: 'Acme', email: 'contact@acme.test', billingEmail: 'billing@acme.test' },
      client,
    );

    expect(updateExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        customerUpdateExternalID: expect.objectContaining({ email: 'billing@acme.test' }),
      }),
    );
  });

  it('is a no-op when billing is disabled', async () => {
    delete process.env[BILLING_FLAG_NAME];
    const client = fakeClient();

    await syncPolarCustomerOnCompanyChange(
      'company-1',
      { name: 'Acme', email: 'a@acme.test', billingEmail: null },
      client,
    );

    expect(client.customers.updateExternal).not.toHaveBeenCalled();
  });

  it('is a no-op — never an error — when this company has no Polar customer at all yet', async () => {
    const updateExternal = jest.fn().mockRejectedValue({ statusCode: 404 });
    const client = fakeClient(updateExternal);

    await expect(
      syncPolarCustomerOnCompanyChange(
        'company-1',
        { name: 'Acme', email: 'a@acme.test', billingEmail: null },
        client,
      ),
    ).resolves.toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('never throws into its caller on a genuine Polar failure — it logs and marks the row for the sweep to retry', async () => {
    const updateExternal = jest.fn().mockRejectedValue(new Error('polar is down'));
    const client = fakeClient(updateExternal);

    await expect(
      syncPolarCustomerOnCompanyChange(
        'company-1',
        { name: 'Acme', email: 'a@acme.test', billingEmail: null },
        client,
      ),
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: { customerSyncFailedAt: expect.any(Date) },
    });
  });

  it('clears a prior failure flag once the retry succeeds', async () => {
    const updateExternal = jest.fn().mockResolvedValue({});
    const client = fakeClient(updateExternal);

    await syncPolarCustomerOnCompanyChange(
      'company-1',
      { name: 'Acme', email: 'a@acme.test', billingEmail: null },
      client,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', customerSyncFailedAt: { not: null } },
      data: { customerSyncFailedAt: null },
    });
  });
});
