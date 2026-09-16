import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import {
  isLegacyUserLevelSubscription,
  LegacyCustomerCheckClient,
  resetLegacySubscriptionCacheForTests,
} from './legacy-customer';

function notFoundError(): Error {
  return Object.assign(new Error('ResourceNotFound'), { statusCode: 404 });
}

function sub(overrides: Partial<CompanySubscription> = {}): CompanySubscription {
  return {
    companyId: 'company-1',
    status: 'ACTIVE',
    polarCustomerId: null,
    ...overrides,
  } as CompanySubscription;
}

function fakeClient(getExternal: jest.Mock): LegacyCustomerCheckClient {
  return { customers: { getExternal } };
}

describe('isLegacyUserLevelSubscription', () => {
  beforeEach(() => resetLegacySubscriptionCacheForTests());
  afterEach(() => jest.resetAllMocks());

  it('is false — never calls Polar — when there is no polarCustomerId at all', async () => {
    const getExternal = jest.fn();
    const result = await isLegacyUserLevelSubscription(
      sub({ polarCustomerId: null }),
      fakeClient(getExternal),
      0,
    );
    expect(result).toBe(false);
    expect(getExternal).not.toHaveBeenCalled();
  });

  it('is false when the company-scoped customer matches the stored polarCustomerId — the new flow', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_company' });
    const result = await isLegacyUserLevelSubscription(
      sub({ polarCustomerId: 'cus_company' }),
      fakeClient(getExternal),
      0,
    );
    expect(result).toBe(false);
    expect(getExternal).toHaveBeenCalledWith({ externalId: 'company-1' });
  });

  it('is true when the company-scoped customer differs from the stored one', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_company_new' });
    const result = await isLegacyUserLevelSubscription(
      sub({ polarCustomerId: 'cus_old_user_level' }),
      fakeClient(getExternal),
      0,
    );
    expect(result).toBe(true);
  });

  it('is true when no company-scoped customer is registered at all yet (404)', async () => {
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const result = await isLegacyUserLevelSubscription(
      sub({ polarCustomerId: 'cus_old_user_level' }),
      fakeClient(getExternal),
      0,
    );
    expect(result).toBe(true);
  });

  it('swallows any other Polar failure and reads as not-legacy (fail safe)', async () => {
    const getExternal = jest.fn().mockRejectedValue(new Error('polar is down'));
    const result = await isLegacyUserLevelSubscription(
      sub({ polarCustomerId: 'cus_x' }),
      fakeClient(getExternal),
      0,
    );
    expect(result).toBe(false);
  });

  it('caches per company within the TTL window', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_company' });
    const client = fakeClient(getExternal);
    const row = sub({ polarCustomerId: 'cus_company' });

    await isLegacyUserLevelSubscription(row, client, 0);
    await isLegacyUserLevelSubscription(row, client, 1000);

    expect(getExternal).toHaveBeenCalledTimes(1);
  });

  it('re-checks once the cache window elapses', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_company' });
    const client = fakeClient(getExternal);
    const row = sub({ polarCustomerId: 'cus_company' });

    await isLegacyUserLevelSubscription(row, client, 0);
    await isLegacyUserLevelSubscription(row, client, 5 * 60 * 1000 + 1);

    expect(getExternal).toHaveBeenCalledTimes(2);
  });
});
