import prisma from '@/prisma/prisma.service';

import { DeletionPolarClient, deleteCompanyPermanently, PolarCancellationFailedError } from './deletion';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    webhook: { deleteMany: jest.fn() },
    company: { delete: jest.fn() },
    companySubscription: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const findSub = prisma.companySubscription.findUnique as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;

const NOW = new Date('2026-09-17T00:00:00.000Z');
const DUE_AT = new Date('2026-09-16T00:00:00.000Z'); // already due as of NOW

function fakeClient(revoke = jest.fn().mockResolvedValue({})): DeletionPolarClient {
  return { subscriptions: { revoke } };
}

/** Every field `isStillDueForDeletion` reads — the same "one row shape" convention every other
 *  spec's own `subRow` helper holds, so a case only needs to override what it actually varies. */
function dueRow(overrides: Record<string, unknown> = {}) {
  return { polarSubscriptionId: null, status: 'ZIPPED', deletionDueAt: DUE_AT, ...overrides };
}

describe('deleteCompanyPermanently', () => {
  beforeEach(() => {
    // Mirrors both the array form (`Promise.all`) this module used to call and the interactive
    // callback form it uses now — the callback is invoked with `prisma` itself as `tx`, so a test's
    // `findSub`/`prisma.webhook.deleteMany`/`prisma.company.delete` mocks apply inside the
    // transaction exactly as they do outside it. Re-assigned every test: `resetAllMocks()` in
    // `afterEach` below wipes a mock's IMPLEMENTATION, not just its call history, so a `jest.fn(impl)`
    // baked in once at module-mock time would silently stop dispatching after the FIRST test.
    transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
  });
  afterEach(() => jest.resetAllMocks());

  it("deletes the company's Webhook rows and the Company row in one transaction, webhooks first", async () => {
    findSub.mockResolvedValue(dueRow()); // never paid — nothing to cancel
    const calls: string[] = [];
    (prisma.webhook.deleteMany as jest.Mock).mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve({ count: 2 });
    });
    (prisma.company.delete as jest.Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    const deleted = await deleteCompanyPermanently('company-1', NOW, fakeClient());

    expect(deleted).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: 'company-1' } });
    expect(calls).toEqual(['webhook', 'company']);
  });

  it("cancels a PAID company's Polar subscription (immediate revoke) BEFORE deleting it", async () => {
    findSub.mockResolvedValue(dueRow({ polarSubscriptionId: 'polar_sub_123' }));
    const revoke = jest.fn().mockResolvedValue({});
    const order: string[] = [];
    revoke.mockImplementation(async () => {
      order.push('revoke');
    });
    (prisma.company.delete as jest.Mock).mockImplementation(async () => {
      order.push('company-delete');
    });

    await deleteCompanyPermanently('company-1', NOW, fakeClient(revoke));

    expect(revoke).toHaveBeenCalledWith({ id: 'polar_sub_123' });
    expect(order).toEqual(['revoke', 'company-delete']);
  });

  it('never even calls Polar for a never-paid company (no polarSubscriptionId)', async () => {
    findSub.mockResolvedValue(dueRow({ polarSubscriptionId: null }));
    const revoke = jest.fn();

    await deleteCompanyPermanently('company-1', NOW, fakeClient(revoke));

    expect(revoke).not.toHaveBeenCalled();
  });

  it('never even calls Polar when the company has no CompanySubscription row at all', async () => {
    findSub.mockResolvedValue(null);
    const revoke = jest.fn();

    const deleted = await deleteCompanyPermanently('company-1', NOW, fakeClient(revoke));

    expect(deleted).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('REFUSES the deletion (named error) when the Polar cancellation fails — never a company deleted while still billed', async () => {
    findSub.mockResolvedValue(dueRow({ polarSubscriptionId: 'polar_sub_123' }));
    const revoke = jest.fn().mockRejectedValue(new Error('polar is down'));

    await expect(deleteCompanyPermanently('company-1', NOW, fakeClient(revoke))).rejects.toThrow(
      PolarCancellationFailedError,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.company.delete).not.toHaveBeenCalled();
  });

  it('the refusal error carries a named, machine-checkable code', async () => {
    findSub.mockResolvedValue(dueRow({ polarSubscriptionId: 'polar_sub_123' }));
    const revoke = jest.fn().mockRejectedValue(new Error('polar is down'));

    await expect(deleteCompanyPermanently('company-1', NOW, fakeClient(revoke))).rejects.toMatchObject({
      code: 'POLAR_CANCELLATION_FAILED',
    });
  });

  describe('stale-read guard (race with a company that stopped being due)', () => {
    it('refuses to delete a row whose status is no longer ZIPPED (a webhook reactivated it since the sweep read it)', async () => {
      findSub.mockResolvedValue(dueRow({ status: 'ACTIVE' }));
      const revoke = jest.fn();

      const deleted = await deleteCompanyPermanently('company-1', NOW, fakeClient(revoke));

      expect(deleted).toBe(false);
      expect(revoke).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.company.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a row whose own grace period has not actually elapsed yet', async () => {
      findSub.mockResolvedValue(dueRow({ deletionDueAt: new Date(NOW.getTime() + 1000) }));

      const deleted = await deleteCompanyPermanently('company-1', NOW, fakeClient());

      expect(deleted).toBe(false);
      expect(prisma.company.delete).not.toHaveBeenCalled();
    });

    it(
      'aborts INSIDE the transaction, never deleting, when the row moved on between the pre-revoke ' +
        'read and the delete itself (the Polar revoke call is a real await in between)',
      async () => {
        // First read (pre-revoke): still due, and a real subscription to cancel. Second read (inside
        // the transaction, right before the actual delete): a webhook landed while the revoke call
        // was in flight and reactivated it.
        findSub
          .mockResolvedValueOnce(dueRow({ polarSubscriptionId: 'polar_sub_123' }))
          .mockResolvedValueOnce(dueRow({ status: 'ACTIVE' }));
        const revoke = jest.fn().mockResolvedValue({});

        const deleted = await deleteCompanyPermanently('company-1', NOW, fakeClient(revoke));

        expect(deleted).toBe(false);
        expect(revoke).toHaveBeenCalled(); // already committed to Polar by the time the race was seen
        expect(prisma.webhook.deleteMany).not.toHaveBeenCalled();
        expect(prisma.company.delete).not.toHaveBeenCalled();
      },
    );
  });
});
