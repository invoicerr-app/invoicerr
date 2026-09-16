import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  ReconcileSubscriptionsClient,
  reconcileFromPolarIfStale,
  resetStatusReconcileCacheForTests,
} from './status-reconcile';
import { applySubscriptionWebhook } from './webhook-handlers';

jest.mock('./company-subscription.store');
jest.mock('./webhook-handlers');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const applyWebhook = applySubscriptionWebhook as jest.Mock;

async function* asPages(items: unknown[]) {
  yield { result: { items } };
}

function fakeClient(items: unknown[]): ReconcileSubscriptionsClient {
  return { subscriptions: { list: jest.fn().mockResolvedValue(asPages(items)) } };
}

function sub(overrides: Record<string, unknown> = {}): CompanySubscription {
  return {
    companyId: 'company-1',
    status: 'TRIAL',
    polarCustomerId: null,
    ...overrides,
  } as CompanySubscription;
}

describe('reconcileFromPolarIfStale', () => {
  beforeEach(() => resetStatusReconcileCacheForTests());
  afterEach(() => jest.resetAllMocks());

  it('does nothing when already ACTIVE — never calls Polar', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'ACTIVE', polarCustomerId: 'cus_1' });

    const result = await reconcileFromPolarIfStale(row, client, 0);

    expect(result).toBe(row);
    expect(client.subscriptions.list as jest.Mock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no polarCustomerId yet', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: null });

    const result = await reconcileFromPolarIfStale(row, client, 0);

    expect(result).toBe(row);
    expect(client.subscriptions.list as jest.Mock).not.toHaveBeenCalled();
  });

  it('applies the most recent Polar subscription through applySubscriptionWebhook and re-reads the row', async () => {
    const client = fakeClient([
      {
        id: 'polar_sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'year',
        metadata: { companyId: 'company-1' },
      },
    ]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });
    getOrCreate.mockResolvedValue({ ...row, status: 'ACTIVE' });

    const result = await reconcileFromPolarIfStale(row, client, 0);

    expect(client.subscriptions.list as jest.Mock).toHaveBeenCalledWith({
      externalCustomerId: 'company-1',
      limit: 10,
    });
    expect(applyWebhook).toHaveBeenCalledWith({
      companyId: 'company-1',
      polarSubscriptionId: 'polar_sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'year',
    });
    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(result.status).toBe('ACTIVE');
  });

  it('filters the Polar list call by this company — not by the stored polarCustomerId', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_shared_with_another_company' });

    await reconcileFromPolarIfStale(row, client, 0);

    expect(client.subscriptions.list as jest.Mock).toHaveBeenCalledWith({
      externalCustomerId: 'company-1',
      limit: 10,
    });
  });

  it('returns the row unchanged when Polar has no subscription for this customer yet', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    const result = await reconcileFromPolarIfStale(row, client, 0);

    expect(result).toBe(row);
    expect(applyWebhook).not.toHaveBeenCalled();
  });

  it('swallows a Polar failure and returns the row unchanged', async () => {
    const client: ReconcileSubscriptionsClient = {
      subscriptions: { list: jest.fn().mockRejectedValue(new Error('polar is down')) },
    };
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    await expect(reconcileFromPolarIfStale(row, client, 0)).resolves.toBe(row);
  });

  it('caches per company — does not re-call Polar within the cache window', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    await reconcileFromPolarIfStale(row, client, 0);
    await reconcileFromPolarIfStale(row, client, 1000);

    expect(client.subscriptions.list as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('re-checks Polar again once the cache window has elapsed', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    await reconcileFromPolarIfStale(row, client, 0);
    await reconcileFromPolarIfStale(row, client, 5 * 60 * 1000 + 1);

    expect(client.subscriptions.list as jest.Mock).toHaveBeenCalledTimes(2);
  });
});
