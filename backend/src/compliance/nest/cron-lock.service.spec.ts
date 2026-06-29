/**
 * CronLockService unit tests (§13).
 *
 * Uses a minimal in-memory PrismaService double that mimics the conditional
 * upsert semantics: $queryRaw returns a row only when the existing lockedUntil
 * is in the past (or the row doesn't exist).
 */
import { CronLockService, CRON_OWNER } from './cron-lock.service';

// ---------------------------------------------------------------------------
// In-memory lock store — simulates Postgres conditional upsert semantics
// ---------------------------------------------------------------------------

interface LockRow {
  name: string;
  lockedUntil: Date;
  owner: string;
}

function makePrismaMock() {
  const store = new Map<string, LockRow>();

  /**
   * Simulates:
   *   INSERT … ON CONFLICT DO UPDATE WHERE lockedUntil < NOW() RETURNING name
   * Returns [{name}] when inserted/updated; [] when lock is still held.
   */
  const rawUpsert = jest.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
    const [name, lockedUntil, owner] = values as [string, Date, string];
    const existing = store.get(name);
    if (!existing || existing.lockedUntil < new Date()) {
      store.set(name, { name, lockedUntil, owner });
      return Promise.resolve([{ name }]);
    }
    return Promise.resolve([]);
  });

  const cronLock = {
    deleteMany: jest.fn(async ({ where }: { where: { name: string; owner: string } }) => {
      const row = store.get(where.name);
      if (row && row.owner === where.owner) store.delete(where.name);
      return { count: 1 };
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { name: string; owner: string }; data: { lockedUntil: Date } }) => {
      const row = store.get(where.name);
      if (row && row.owner === where.owner) {
        store.set(where.name, { ...row, lockedUntil: data.lockedUntil });
      }
      return { count: 1 };
    }),
  };

  return {
    prisma: { $queryRaw: rawUpsert, cronLock } as unknown as ConstructorParameters<typeof CronLockService>[0],
    rawUpsert,
    cronLock,
    store,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CronLockService', () => {
  describe('tryAcquire', () => {
    it('acquires a lock when no row exists', async () => {
      const { prisma } = makePrismaMock();
      const service = new CronLockService(prisma);
      const acquired = await service.tryAcquire('test-job', 5_000);
      expect(acquired).toBe(true);
    });

    it('can re-acquire after the lock expires', async () => {
      const { prisma } = makePrismaMock();
      const service = new CronLockService(prisma);
      // First acquire with 1 ms TTL
      await service.tryAcquire('job', 1);
      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));
      // Should be re-acquirable now
      const reacquired = await service.tryAcquire('job', 5_000);
      expect(reacquired).toBe(true);
    });

    it('second owner is blocked while lock is held (two owners, one wins)', async () => {
      const { prisma, rawUpsert } = makePrismaMock();
      const service = new CronLockService(prisma);

      // First call acquires
      const first = await service.tryAcquire('shared-job', 60_000);
      expect(first).toBe(true);

      // Simulate a second instance: patch the raw upsert to return 0 rows (lock still held)
      rawUpsert.mockResolvedValueOnce([]);
      const second = await service.tryAcquire('shared-job', 60_000);
      expect(second).toBe(false);
    });

    it('after expiry, a second owner can acquire (contention scenario)', async () => {
      const { prisma, rawUpsert } = makePrismaMock();
      const service = new CronLockService(prisma);

      // First owner acquires with 1 ms TTL
      await service.tryAcquire('contested', 1);
      // Immediately blocked
      rawUpsert.mockResolvedValueOnce([]); // still held
      const ownerBImmediate = await service.tryAcquire('contested', 60_000);
      expect(ownerBImmediate).toBe(false);

      // After expiry the conditional upsert succeeds
      await new Promise((r) => setTimeout(r, 10));
      // The in-memory store now has an expired row → rawUpsert will return the row
      const ownerBAfterExpiry = await service.tryAcquire('contested', 60_000);
      expect(ownerBAfterExpiry).toBe(true);
    });

    it('fails open (returns true) when DB throws — cron must not halt', async () => {
      const { prisma, rawUpsert } = makePrismaMock();
      const service = new CronLockService(prisma);
      rawUpsert.mockRejectedValueOnce(new Error('DB unavailable'));
      const acquired = await service.tryAcquire('job', 5_000);
      expect(acquired).toBe(true);
    });
  });

  describe('release', () => {
    it('calls deleteMany with the correct owner filter', async () => {
      const { prisma, cronLock } = makePrismaMock();
      const service = new CronLockService(prisma);
      await service.tryAcquire('job', 60_000);
      await service.release('job');
      expect(cronLock.deleteMany).toHaveBeenCalledWith({
        where: { name: 'job', owner: CRON_OWNER },
      });
    });

    it('is idempotent — second release is a no-op', async () => {
      const { prisma, cronLock } = makePrismaMock();
      const service = new CronLockService(prisma);
      await service.tryAcquire('job', 60_000);
      await service.release('job');
      await service.release('job'); // second call
      expect(cronLock.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('renew', () => {
    it('updates lockedUntil for the current owner', async () => {
      const { prisma, cronLock } = makePrismaMock();
      const service = new CronLockService(prisma);
      await service.tryAcquire('job', 60_000);
      await service.renew('job', 120_000);
      expect(cronLock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'job', owner: CRON_OWNER } }),
      );
    });
  });
});
