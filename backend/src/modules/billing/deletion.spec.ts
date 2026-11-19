import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { deleteCompanyPermanently, deleteCompanyPermanentlyNow } from './deletion';
import { cancelCompanyStripeSubscriptions } from './stripe-subscription-cancel';

vi.mock('./stripe-subscription-cancel', () => ({ cancelCompanyStripeSubscriptions: vi.fn() }));
const cancelStripe = cancelCompanyStripeSubscriptions as Mock;

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    webhook: { deleteMany: vi.fn() },
    company: { delete: vi.fn() },
    companySubscription: { findUnique: vi.fn() },
    userCompany: { findMany: vi.fn() },
    // The storage-erasure journal both deletion paths now write inside their own transaction, and
    // drain right after it (`documents/archive/company-storage-erasure.ts`). Stubbed empty here: this
    // spec is about the FK/stale-read disciplines, and the erasure itself is proven against real
    // files on a real filesystem in that module's own colocated spec.
    documentArchive: { findMany: vi.fn().mockResolvedValue([]) },
    pendingStorageErasure: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const findSub = prisma.companySubscription.findUnique as Mock;
const transaction = prisma.$transaction as Mock;

/** The storage-erasure journal's own mocks, re-armed every test for the same reason `transaction`'s
 *  implementation is: `resetAllMocks()` wipes implementations, not just call history, so an empty
 *  default baked in at module-mock time would silently start returning `undefined` after the first
 *  test and take `journalCompanyStorageObjects` down with it. */
function resetStorageErasureMocks() {
  (prisma.documentArchive.findMany as Mock).mockResolvedValue([]);
  (prisma.pendingStorageErasure.createMany as Mock).mockResolvedValue({ count: 0 });
  (prisma.pendingStorageErasure.findMany as Mock).mockResolvedValue([]);
  (prisma.userCompany.findMany as Mock).mockResolvedValue([]);
}

const NOW = new Date('2026-09-17T00:00:00.000Z');
const DUE_AT = new Date('2026-09-16T00:00:00.000Z'); // already due as of NOW

/** Every field `isStillDueForDeletion` reads, the same "one row shape" convention every other
 *  spec's own `subRow` helper holds, so a case only needs to override what it actually varies. */
function dueRow(overrides: Record<string, unknown> = {}) {
  return { status: 'ZIPPED', deletionDueAt: DUE_AT, ...overrides };
}

describe('deleteCompanyPermanently', () => {
  beforeEach(() => {
    // Mirrors both the array form (`Promise.all`) this module used to call and the interactive
    // callback form it uses now, the callback is invoked with `prisma` itself as `tx`, so a test's
    // `findSub`/`prisma.webhook.deleteMany`/`prisma.company.delete` mocks apply inside the
    // transaction exactly as they do outside it. Re-assigned every test: `resetAllMocks()` in
    // `afterEach` below wipes a mock's IMPLEMENTATION, not just its call history, so a `vi.fn(impl)`
    // baked in once at module-mock time would silently stop dispatching after the FIRST test.
    transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    resetStorageErasureMocks();
  });
  afterEach(() => vi.resetAllMocks());

  it("deletes the company's Webhook rows and the Company row in one transaction, webhooks first", async () => {
    findSub.mockResolvedValue(dueRow());
    const calls: string[] = [];
    (prisma.webhook.deleteMany as Mock).mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve({ count: 2 });
    });
    (prisma.company.delete as Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    const deleted = await deleteCompanyPermanently('company-1', NOW);

    expect(deleted).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: 'company-1' } });
    expect(calls).toEqual(['webhook', 'company']);
  });

  it('deletes nothing when the company has no CompanySubscription row at all', async () => {
    findSub.mockResolvedValue(null);

    const deleted = await deleteCompanyPermanently('company-1', NOW);

    expect(deleted).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cancels the company Stripe subscriptions before the deletion transaction', async () => {
    findSub.mockResolvedValue(dueRow());
    const calls: string[] = [];
    cancelStripe.mockImplementation(() => {
      calls.push('cancel-stripe');
      return Promise.resolve(1);
    });
    (prisma.company.delete as Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    await deleteCompanyPermanently('company-1', NOW);

    expect(cancelStripe).toHaveBeenCalledWith('company-1');
    expect(calls).toEqual(['cancel-stripe', 'company']);
  });

  it('deletes nothing when Stripe cannot cancel, so the next sweep retries', async () => {
    findSub.mockResolvedValue(dueRow());
    cancelStripe.mockRejectedValue(new Error('Stripe is down'));

    await expect(deleteCompanyPermanently('company-1', NOW)).rejects.toThrow('Stripe is down');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never cancels the Stripe subscription of a company that is no longer due', async () => {
    findSub.mockResolvedValue(dueRow({ status: 'ACTIVE' }));

    await deleteCompanyPermanently('company-1', NOW);

    expect(cancelStripe).not.toHaveBeenCalled();
  });

  describe('stale-read guard (race with a company that stopped being due)', () => {
    it('refuses to delete a row whose status is no longer ZIPPED (a webhook reactivated it since the sweep read it)', async () => {
      findSub.mockResolvedValue(dueRow({ status: 'ACTIVE' }));

      const deleted = await deleteCompanyPermanently('company-1', NOW);

      expect(deleted).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.company.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a row whose own grace period has not actually elapsed yet', async () => {
      findSub.mockResolvedValue(dueRow({ deletionDueAt: new Date(NOW.getTime() + 1000) }));

      const deleted = await deleteCompanyPermanently('company-1', NOW);

      expect(deleted).toBe(false);
      expect(prisma.company.delete).not.toHaveBeenCalled();
    });

    it(
      'aborts INSIDE the transaction, never deleting, when the row moved on between the first read ' +
        'and the delete itself',
      async () => {
        // First read: still due. Second read (inside the transaction, right before the actual
        // delete): a billing event landed in between and reactivated it.
        findSub.mockResolvedValueOnce(dueRow()).mockResolvedValueOnce(dueRow({ status: 'ACTIVE' }));
        const deleted = await deleteCompanyPermanently('company-1', NOW);

        expect(deleted).toBe(false);
        expect(prisma.webhook.deleteMany).not.toHaveBeenCalled();
        expect(prisma.company.delete).not.toHaveBeenCalled();
      },
    );
  });
});

describe('deleteCompanyPermanentlyNow, manual, OWNER-initiated deletion (danger zone "Delete company")', () => {
  beforeEach(() => {
    transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    resetStorageErasureMocks();
  });
  afterEach(() => vi.resetAllMocks());

  it('writes the storage inventory INSIDE the transaction, before any delete, and drains it after the commit', async () => {
    const calls: string[] = [];
    let committed = false;
    (prisma.pendingStorageErasure.createMany as Mock).mockImplementation(() => {
      calls.push('journal');
      return Promise.resolve({ count: 1 });
    });
    (prisma.webhook.deleteMany as Mock).mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve({ count: 0 });
    });
    (prisma.company.delete as Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });
    transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => {
      const result = await fn(prisma);
      committed = true;
      return result;
    });
    // The drain reads the journal, and must only ever do so once the transaction has committed:
    // object storage has no rollback, so a byte deleted under a transaction that later aborts is
    // simply gone, with the rows that named it still in place.
    (prisma.pendingStorageErasure.findMany as Mock).mockImplementation(() => {
      calls.push(committed ? 'drain-after-commit' : 'drain-INSIDE-transaction');
      return Promise.resolve([]);
    });

    await deleteCompanyPermanentlyNow('company-1');

    expect(calls).toEqual(['journal', 'webhook', 'company', 'drain-after-commit']);
  });

  it('deletes Webhook then Company, in one transaction, no CompanySubscription.status/deletionDueAt gate at all', async () => {
    const calls: string[] = [];
    (prisma.webhook.deleteMany as Mock).mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve({ count: 0 });
    });
    (prisma.company.delete as Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    await deleteCompanyPermanentlyNow('company-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: 'company-1' } });
    expect(calls).toEqual(['webhook', 'company']);
  });

  it('deletes even a company whose subscription is ACTIVE/TRIAL/PAST_DUE, explicit consent is the only gate, not a lifecycle status', async () => {
    findSub.mockResolvedValue({ status: 'ACTIVE', deletionDueAt: null });

    await deleteCompanyPermanentlyNow('company-1');

    // `deleteCompanyPermanently` (the sweep-driven twin) would have refused this exact row, see
    // this file's own "stale-read guard" tests above, because ACTIVE is never due for AUTOMATIC
    // deletion. This function has no such check: it is one, does not re-read after any await.
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: 'company-1' } });
  });

  it('cancels the company Stripe subscriptions before any row is touched', async () => {
    const calls: string[] = [];
    cancelStripe.mockImplementation(() => {
      calls.push('cancel-stripe');
      return Promise.resolve(1);
    });
    (prisma.company.delete as Mock).mockImplementation(() => {
      calls.push('company');
      return Promise.resolve({});
    });

    await deleteCompanyPermanentlyNow('company-1');

    expect(cancelStripe).toHaveBeenCalledWith('company-1');
    expect(calls).toEqual(['cancel-stripe', 'company']);
  });

  it('deletes nothing when Stripe cannot cancel', async () => {
    cancelStripe.mockRejectedValue(new Error('Stripe is down'));

    await expect(deleteCompanyPermanentlyNow('company-1')).rejects.toThrow('Stripe is down');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.company.delete).not.toHaveBeenCalled();
  });
});
