import { vi, type Mock } from 'vitest';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import {
  getOrCreateCompanySubscription,
  recomputeStatusForVanishedSubscription,
} from './company-subscription.store';
import {
  ReconcileSubscriptionsClient,
  reconcileFromPolarIfStale,
  resetStatusReconcileCacheForTests,
} from './status-reconcile';
import { applySubscriptionWebhook } from './webhook-handlers';

vi.mock('./company-subscription.store');
vi.mock('./webhook-handlers');

const getOrCreate = getOrCreateCompanySubscription as Mock;
const applyWebhook = applySubscriptionWebhook as Mock;
const recomputeVanished = recomputeStatusForVanishedSubscription as Mock;

async function* asPages(items: unknown[]) {
  yield { result: { items } };
}

function fakeClient(items: unknown[]): ReconcileSubscriptionsClient {
  return { subscriptions: { list: vi.fn().mockResolvedValue(asPages(items)) } };
}

function sub(overrides: Record<string, unknown> = {}): CompanySubscription {
  return {
    companyId: 'company-1',
    status: 'TRIAL',
    polarCustomerId: null,
    trialEndsAt: new Date('2020-01-01T00:00:00.000Z'),
    lastPolarFactAt: null,
    ...overrides,
  } as CompanySubscription;
}

describe('reconcileFromPolarIfStale', () => {
  beforeEach(() => resetStatusReconcileCacheForTests());
  afterEach(() => vi.resetAllMocks());

  it('does nothing when there is no polarCustomerId yet', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: null });

    const result = await reconcileFromPolarIfStale(row, client, 0);

    expect(result).toBe(row);
    expect(client.subscriptions.list as Mock).not.toHaveBeenCalled();
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

    expect(client.subscriptions.list as Mock).toHaveBeenCalledWith({
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

  it('threads currentPeriodEnd through to applySubscriptionWebhook, for the paid-period Terms exception', async () => {
    const currentPeriodEnd = new Date('2026-10-18T00:00:00.000Z');
    const client = fakeClient([
      {
        id: 'polar_sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'year',
        metadata: { companyId: 'company-1' },
        currentPeriodEnd,
      },
    ]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });
    getOrCreate.mockResolvedValue({ ...row, status: 'ACTIVE' });

    await reconcileFromPolarIfStale(row, client, 0);

    expect(applyWebhook).toHaveBeenCalledWith(expect.objectContaining({ currentPeriodEnd }));
  });

  it('filters the Polar list call by this company — not by the stored polarCustomerId', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_shared_with_another_company' });

    await reconcileFromPolarIfStale(row, client, 0);

    expect(client.subscriptions.list as Mock).toHaveBeenCalledWith({
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

  it("threads the Polar subscription's own modifiedAt through as factAt, so a stale read can never clobber a fresher webhook fact", async () => {
    const modifiedAt = '2026-09-16T10:05:00.000Z';
    const client = fakeClient([
      {
        id: 'polar_sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'year',
        metadata: { companyId: 'company-1' },
        modifiedAt,
      },
    ]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });
    getOrCreate.mockResolvedValue({ ...row, status: 'ACTIVE' });

    await reconcileFromPolarIfStale(row, client, 0);

    expect(applyWebhook).toHaveBeenCalledWith(expect.objectContaining({ factAt: new Date(modifiedAt) }));
  });

  it('falls back to createdAt for factAt when Polar reports no modifiedAt at all', async () => {
    const createdAt = '2026-09-10T08:00:00.000Z';
    const client = fakeClient([
      {
        id: 'polar_sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'year',
        metadata: { companyId: 'company-1' },
        modifiedAt: null,
        createdAt,
      },
    ]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });
    getOrCreate.mockResolvedValue({ ...row, status: 'ACTIVE' });

    await reconcileFromPolarIfStale(row, client, 0);

    expect(applyWebhook).toHaveBeenCalledWith(expect.objectContaining({ factAt: new Date(createdAt) }));
  });

  it('recomputes an ACTIVE row whose own company-scoped customer has NO subscription at all', async () => {
    const client = fakeClient([]);
    const row = sub({
      status: 'ACTIVE',
      polarCustomerId: 'cus_company',
      trialEndsAt: new Date('2020-01-01T00:00:00.000Z'),
      lastPolarFactAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const recomputed = { ...row, status: 'PAST_DUE' };
    recomputeVanished.mockResolvedValue(recomputed);

    const result = await reconcileFromPolarIfStale(row, client, 5_000);

    expect(client.subscriptions.list as Mock).toHaveBeenCalledWith({
      externalCustomerId: 'company-1',
      limit: 10,
    });
    expect(recomputeVanished).toHaveBeenCalledWith(
      'company-1',
      row.trialEndsAt,
      row.lastPolarFactAt,
      new Date(5_000),
    );
    expect(applyWebhook).not.toHaveBeenCalled();
    expect(result).toBe(recomputed);
  });

  it('anchors the recompute on now when this row has no lastPolarFactAt to fall back to', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'ACTIVE', polarCustomerId: 'cus_company', lastPolarFactAt: null });
    recomputeVanished.mockResolvedValue({ ...row, status: 'PAST_DUE' });

    await reconcileFromPolarIfStale(row, client, 9_000);

    expect(recomputeVanished).toHaveBeenCalledWith(
      'company-1',
      row.trialEndsAt,
      new Date(9_000),
      new Date(9_000),
    );
  });

  it('never recomputes a NON-ACTIVE row with no subscription — that is a normal, unrelated state', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'BLOCKED', polarCustomerId: 'cus_company' });

    const result = await reconcileFromPolarIfStale(row, client, 0);

    expect(result).toBe(row);
    expect(recomputeVanished).not.toHaveBeenCalled();
  });

  it('applies a real subscription found for an ACTIVE row exactly like a non-ACTIVE one', async () => {
    const client = fakeClient([
      {
        id: 'polar_sub_1',
        customerId: 'cus_company',
        status: 'active',
        recurringInterval: 'year',
        metadata: {},
      },
    ]);
    const row = sub({ status: 'ACTIVE', polarCustomerId: 'cus_company' });
    getOrCreate.mockResolvedValue({ ...row, status: 'ACTIVE' });

    await reconcileFromPolarIfStale(row, client, 0);

    expect(applyWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', polarSubscriptionId: 'polar_sub_1' }),
    );
    expect(recomputeVanished).not.toHaveBeenCalled();
  });

  it('swallows a Polar failure and returns the row unchanged', async () => {
    const client: ReconcileSubscriptionsClient = {
      subscriptions: { list: vi.fn().mockRejectedValue(new Error('polar is down')) },
    };
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    await expect(reconcileFromPolarIfStale(row, client, 0)).resolves.toBe(row);
  });

  it('caches per company — does not re-call Polar within the cache window', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    await reconcileFromPolarIfStale(row, client, 0);
    await reconcileFromPolarIfStale(row, client, 1000);

    expect(client.subscriptions.list as Mock).toHaveBeenCalledTimes(1);
  });

  it('re-checks Polar again once the cache window has elapsed', async () => {
    const client = fakeClient([]);
    const row = sub({ status: 'TRIAL', polarCustomerId: 'cus_1' });

    await reconcileFromPolarIfStale(row, client, 0);
    await reconcileFromPolarIfStale(row, client, 5 * 60 * 1000 + 1);

    expect(client.subscriptions.list as Mock).toHaveBeenCalledTimes(2);
  });
});
