import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import {
  CompanyCustomerFactsClient,
  getCompanyCustomerFacts,
  hasLegacyPolarCustomer,
  resetCompanyCustomerFactsCacheForTests,
  resetLegacyPortalAvailabilityCacheForTests,
} from './legacy-customer';

function fakeClient(
  overrides: { customers?: Partial<CompanyCustomerFactsClient['customers']> } = {},
): CompanyCustomerFactsClient {
  return {
    customers: { getExternal: jest.fn(), getState: jest.fn(), ...overrides.customers },
  } as unknown as CompanyCustomerFactsClient;
}

function notFoundError(): Error {
  return Object.assign(new Error('ResourceNotFound'), { statusCode: 404 });
}

function sub(overrides: Partial<CompanySubscription>): CompanySubscription {
  return {
    id: 'sub-1',
    companyId: 'company-1',
    status: 'ACTIVE',
    trialStartedAt: new Date(),
    trialEndsAt: new Date(),
    blockedAt: null,
    zipSentAt: null,
    deletionDueAt: null,
    polarCustomerId: null,
    polarSubscriptionId: null,
    seats: 1,
    interval: null,
    seatPaymentFailedAt: null,
    customerSyncFailedAt: null,
    lastCheckoutStartedAt: null,
    lastPolarFactAt: null,
    billingWarningMilestonesSent: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CompanySubscription;
}

describe('getCompanyCustomerFacts', () => {
  beforeEach(() => resetCompanyCustomerFactsCacheForTests());

  it('has a company customer and is not legacy when the company-scoped customer matches the stored id (no getState call needed)', async () => {
    const getState = jest.fn();
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockResolvedValue({ id: 'cus_company' }), getState },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_company' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: false });
    expect(getState).not.toHaveBeenCalled();
  });

  it('has a company customer and flags legacy when the OLD customer (stored id, differing) still has an active subscription', async () => {
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_company' }),
        getState: jest.fn().mockResolvedValue({ activeSubscriptions: [{ id: 'sub_old' }] }),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: true });
    expect(client.customers.getState as jest.Mock).toHaveBeenCalledWith({ id: 'cus_old_user_level' });
  });

  it('has a company customer but is NOT legacy when the OLD customer still exists but has no active subscription (canceled)', async () => {
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_company' }),
        getState: jest.fn().mockResolvedValue({ activeSubscriptions: [] }),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: false });
  });

  it('has a company customer but is NOT legacy when the OLD customer itself was deleted (404) — the reported incident', async () => {
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_company' }),
        getState: jest.fn().mockRejectedValue(notFoundError()),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: true, legacySubscription: false });
  });

  it('has no company customer and flags legacy when 404 on the company scope but the OLD customer still has an active subscription', async () => {
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockRejectedValue(notFoundError()),
        getState: jest.fn().mockResolvedValue({ activeSubscriptions: [{ id: 'sub_old' }] }),
      },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old_user_level' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: false, legacySubscription: true });
  });

  it('has no company customer and is not legacy when 404 and no polarCustomerId at all (fresh trial)', async () => {
    const client = fakeClient({ customers: { getExternal: jest.fn().mockRejectedValue(notFoundError()) } });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: null }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: false, legacySubscription: false });
  });

  it('defaults to the safer reading (no notice, no hidden button) on an unrelated Polar failure', async () => {
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockRejectedValue(new Error('polar is down')) },
    });

    const facts = await getCompanyCustomerFacts(sub({ polarCustomerId: 'cus_old' }), client, 0);

    expect(facts).toEqual({ hasCompanyCustomer: false, legacySubscription: false });
    expect(client.customers.getState as jest.Mock).not.toHaveBeenCalled();
  });

  it('caches the result for 5 minutes per company', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_company' });
    const client = fakeClient({ customers: { getExternal, getState: jest.fn() } });
    const s = sub({ polarCustomerId: 'cus_company' });

    await getCompanyCustomerFacts(s, client, 0);
    await getCompanyCustomerFacts(s, client, 60_000);
    expect(getExternal).toHaveBeenCalledTimes(1);

    await getCompanyCustomerFacts(s, client, 5 * 60_000 + 1);
    expect(getExternal).toHaveBeenCalledTimes(2);
  });
});

describe('hasLegacyPolarCustomer', () => {
  beforeEach(() => resetLegacyPortalAvailabilityCacheForTests());

  it('is true when a Polar customer exists at this user id', async () => {
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockResolvedValue({ id: 'cus_user' }) },
    });

    expect(await hasLegacyPolarCustomer('user-1', client, 0)).toBe(true);
  });

  it('is false on a 404', async () => {
    const client = fakeClient({ customers: { getExternal: jest.fn().mockRejectedValue(notFoundError()) } });

    expect(await hasLegacyPolarCustomer('user-1', client, 0)).toBe(false);
  });

  it('is false (never throws) on an unrelated Polar failure', async () => {
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockRejectedValue(new Error('polar is down')) },
    });

    expect(await hasLegacyPolarCustomer('user-1', client, 0)).toBe(false);
  });

  it('caches the result for 5 minutes per user', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_user' });
    const client = fakeClient({ customers: { getExternal } });

    await hasLegacyPolarCustomer('user-1', client, 0);
    await hasLegacyPolarCustomer('user-1', client, 60_000);
    expect(getExternal).toHaveBeenCalledTimes(1);

    await hasLegacyPolarCustomer('user-1', client, 5 * 60_000 + 1);
    expect(getExternal).toHaveBeenCalledTimes(2);
  });
});
