import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { getPolarClient } from './polar-client';
import {
  countCompanySeats,
  resetSeatSyncCoalescingForTests,
  syncCompanySeatsOnMembershipChange,
} from './seat-sync';

/** A fake interactive-transaction client — `prisma.$transaction(async (tx) => ...)` hands the callback
 *  this shape instead of the real `Prisma.TransactionClient`, the same "narrow, hand-rolled fake" every
 *  other billing spec uses for the Polar SDK client. */
function fakeTx(overrides: {
  sub: { seats: number; polarSubscriptionId: string | null; seatPaymentFailedAt?: Date | null };
  seats: number;
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'sub-row-1' }]),
    companySubscription: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ seatPaymentFailedAt: null, ...overrides.sub }),
      update: jest.fn().mockResolvedValue({}),
    },
    userCompany: { count: jest.fn().mockResolvedValue(overrides.seats) },
  };
}

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: { count: jest.fn() },
    companySubscription: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./company-subscription.store');
// `getPolarClient` alone — `callPolarWithRetry` stays the REAL implementation (its own coverage is
// polar-client.spec.ts): an auto-mock of the whole module would replace it with a stub that never
// actually calls the function it's handed, silently no-op-ing every Polar push in this spec.
jest.mock('./polar-client', () => ({
  ...jest.requireActual('./polar-client'),
  getPolarClient: jest.fn(),
}));

const count = prisma.userCompany.count as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const getClient = getPolarClient as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

/** Wires `prisma.$transaction` to actually invoke its callback against a fresh `fakeTx`, the way the
 *  real interactive-transaction API does — returns the `tx` so a test can assert against its mocks. */
function stubTransaction(overrides: Parameters<typeof fakeTx>[0]) {
  const tx = fakeTx(overrides);
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn(tx));
  return tx;
}

describe('syncCompanySeatsOnMembershipChange', () => {
  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
    resetSeatSyncCoalescingForTests();
  });

  afterEach(() => {
    jest.resetAllMocks();
    resetSeatSyncCoalescingForTests();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op when billing is disabled', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await syncCompanySeatsOnMembershipChange('company-1');
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('updates the stored seat count when it changed, but never calls Polar without a polarSubscriptionId', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 1, polarSubscriptionId: null }, seats: 3 });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(tx.companySubscription.update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: { seats: 3 },
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it('does not write when the count did not change', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 2, polarSubscriptionId: null }, seats: 2 });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(tx.companySubscription.update).not.toHaveBeenCalled();
  });

  it('pushes the new seat count to Polar via subscriptions.update when a polarSubscriptionId exists', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 4 });
    const subscriptionsUpdate = jest.fn().mockResolvedValue({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(subscriptionsUpdate).toHaveBeenCalledWith({
      id: 'polar_sub_123',
      subscriptionUpdate: { seats: 4 },
    });
  });

  it('prorates a seat DECREASE (a member leaving) at the next period, never an immediate credit', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 5, polarSubscriptionId: 'polar_sub_123' }, seats: 4 });
    const subscriptionsUpdate = jest.fn().mockResolvedValue({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(subscriptionsUpdate).toHaveBeenCalledWith({
      id: 'polar_sub_123',
      subscriptionUpdate: { seats: 4, prorationBehavior: 'next_period' },
    });
  });

  it('leaves proration at the organization default for a seat INCREASE', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 4, polarSubscriptionId: 'polar_sub_123' }, seats: 5 });
    const subscriptionsUpdate = jest.fn().mockResolvedValue({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(subscriptionsUpdate).toHaveBeenCalledWith({
      id: 'polar_sub_123',
      subscriptionUpdate: { seats: 5 },
    });
  });

  it('retries a rate-limited push (429) through callPolarWithRetry and still succeeds', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 4 });
    const subscriptionsUpdate = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValueOnce({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(subscriptionsUpdate).toHaveBeenCalledTimes(2);
  });

  it('never throws — a Polar failure is logged and swallowed', async () => {
    getOrCreate.mockResolvedValue({});
    stubTransaction({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 2 });
    getClient.mockReturnValue({
      subscriptions: { update: jest.fn().mockRejectedValue(new Error('polar is down')) },
    });

    await expect(syncCompanySeatsOnMembershipChange('company-1')).resolves.toBeUndefined();
  });

  it('a generic Polar failure never rolls back the local seat count write', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 4 });
    getClient.mockReturnValue({
      subscriptions: { update: jest.fn().mockRejectedValue(new Error('polar is down')) },
    });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(tx.companySubscription.update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: { seats: 4 },
    });
  });

  it('a declined card on a seat INCREASE records seatPaymentFailedAt for Settings > Billing to explain, without rethrowing', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 2 });
    getClient.mockReturnValue({
      subscriptions: {
        update: jest.fn().mockRejectedValue({ error: 'PaymentFailed', detail: 'card declined' }),
      },
    });

    await expect(syncCompanySeatsOnMembershipChange('company-1')).resolves.toBeUndefined();

    expect(tx.companySubscription.update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: { seatPaymentFailedAt: expect.any(Date) },
    });
  });

  it('never records seatPaymentFailedAt for a seat DECREASE, even on a PaymentError shape (proration credit, never charges)', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 5, polarSubscriptionId: 'polar_sub_123' }, seats: 3 });
    getClient.mockReturnValue({
      subscriptions: {
        update: jest.fn().mockRejectedValue({ error: 'PaymentError', detail: 'irrelevant here' }),
      },
    });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(tx.companySubscription.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { seatPaymentFailedAt: expect.any(Date) } }),
    );
  });

  it('clears a prior seatPaymentFailedAt once a later push succeeds', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({
      sub: { seats: 1, polarSubscriptionId: 'polar_sub_123', seatPaymentFailedAt: new Date('2026-09-01') },
      seats: 2,
    });
    getClient.mockReturnValue({ subscriptions: { update: jest.fn().mockResolvedValue({}) } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(tx.companySubscription.update).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: { seatPaymentFailedAt: null },
    });
  });

  it('holds a row lock (SELECT … FOR UPDATE) for the whole read-then-push sequence, serializing concurrent pushes for the SAME company', async () => {
    getOrCreate.mockResolvedValue({});
    const tx = stubTransaction({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 2 });
    getClient.mockReturnValue({ subscriptions: { update: jest.fn().mockResolvedValue({}) } });

    await syncCompanySeatsOnMembershipChange('company-1');

    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('two near-simultaneous membership changes for the SAME company never fire two overlapping Polar pushes — the trailing one always carries the FINAL count', async () => {
    getOrCreate.mockResolvedValue({});

    // Two different counts, depending on WHEN each transaction actually runs — 3 for whichever
    // transaction runs first, 5 once the second membership change has also landed.
    let callNumber = 0;
    const subscriptionsUpdate = jest.fn().mockResolvedValue({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      callNumber += 1;
      const seats = callNumber === 1 ? 3 : 5;
      const tx = fakeTx({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats });
      await fn(tx);
    });

    // Two calls fired back to back, BEFORE the first one's transaction has resolved — the second must
    // coalesce into a single trailing rerun rather than starting its own overlapping push.
    const first = syncCompanySeatsOnMembershipChange('company-1');
    const second = syncCompanySeatsOnMembershipChange('company-1');
    await Promise.all([first, second]);

    // Exactly two real syncs (the in-flight one, plus ONE trailing rerun for the change that landed
    // during it) — never one per call, and the LAST push carries the final, freshly-read count (5).
    expect(subscriptionsUpdate).toHaveBeenCalledTimes(2);
    expect(subscriptionsUpdate.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        id: 'polar_sub_123',
        subscriptionUpdate: expect.objectContaining({ seats: 5 }),
      }),
    );
  });

  it('a burst of near-simultaneous membership changes (bulk provisioning) never fires N Polar calls for N members', async () => {
    getOrCreate.mockResolvedValue({});
    const subscriptionsUpdate = jest.fn().mockResolvedValue({});
    getClient.mockReturnValue({ subscriptions: { update: subscriptionsUpdate } });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = fakeTx({ sub: { seats: 1, polarSubscriptionId: 'polar_sub_123' }, seats: 10 });
      await fn(tx);
    });

    // Ten membership changes for the same company, fired without awaiting each other — the realistic
    // shape of an SSO/invitation burst provisioning ten users at once.
    await Promise.all(Array.from({ length: 10 }, () => syncCompanySeatsOnMembershipChange('company-1')));

    // Never 10 — the in-flight run plus, at most, one trailing rerun.
    expect(subscriptionsUpdate.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('countCompanySeats', () => {
  afterEach(() => jest.resetAllMocks());

  it('counts UserCompany rows for the company', async () => {
    count.mockResolvedValue(5);
    await expect(countCompanySeats('company-1')).resolves.toBe(5);
    expect(count).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
  });
});
