import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { LOG_PURGE_BATCH_SIZE } from './log-purge-sweep';
import { LogPurgeSweepRunner } from './log-purge-sweep-runner';

// Same "mock the prisma singleton default export" shape currency-rate-sweep-runner.spec.ts already
// uses for a plain-function persistence file — this runner talks to `prisma.log` directly, never
// through a service class.
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    log: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const findMany = prisma.log.findMany as Mock;
const deleteMany = prisma.log.deleteMany as Mock;

interface FakeLogRow {
  id: string;
  companyId: string | null;
  timestamp: Date;
}

/**
 * A small, STATEFUL fake over `prisma.log` — real enough to prove actual deletion semantics (which
 * rows survive, which batch a company's own oldest rows land in, that a second call resumes where the
 * first left off) rather than merely asserting on call arguments. Mirrors exactly the two query
 * shapes `LogPurgeSweepRunner` issues (see that file's own header): a `distinct: ['companyId']` scan
 * for discovery, and a per-`companyId` (`null` included) `orderBy timestamp asc, take N` batch select.
 * `deleteMany` removes whatever ids it is given and reports the real resulting count, exactly like
 * Postgres would for a row already gone (nothing here assumes `count === ids.length`).
 */
function installFakeLogStore(initialRows: FakeLogRow[]) {
  let rows = [...initialRows];

  findMany.mockImplementation(
    async (args: {
      where: { timestamp: { lt: Date }; companyId?: string | null };
      distinct?: string[];
      take?: number;
    }) => {
      const cutoffMs = args.where.timestamp.lt.getTime();
      if (args.distinct) {
        const seen = new Set<string | null>();
        const groups: { companyId: string | null }[] = [];
        for (const row of rows) {
          if (row.timestamp.getTime() < cutoffMs && !seen.has(row.companyId)) {
            seen.add(row.companyId);
            groups.push({ companyId: row.companyId });
          }
        }
        return groups;
      }

      const companyId = args.where.companyId ?? null;
      let matching = rows
        .filter((row) => row.companyId === companyId && row.timestamp.getTime() < cutoffMs)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      if (typeof args.take === 'number') matching = matching.slice(0, args.take);
      return matching.map((row) => ({ id: row.id }));
    },
  );

  deleteMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
    const ids = new Set(args.where.id.in);
    const before = rows.length;
    rows = rows.filter((row) => !ids.has(row.id));
    return { count: before - rows.length };
  });

  return { getRows: () => rows };
}

/** `count` rows for `companyId`, timestamps strictly ascending starting at `baseMs`, one per
 *  millisecond — distinct enough for oldest-first ordering to be unambiguous in assertions below. */
function makeRows(companyId: string | null, prefix: string, count: number, baseMs: number): FakeLogRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    companyId,
    timestamp: new Date(baseMs + i),
  }));
}

describe('LogPurgeSweepRunner.runSweep', () => {
  const ORIGINAL_RETENTION = process.env.LOG_RETENTION_DAYS;

  afterEach(() => {
    vi.resetAllMocks();
    if (ORIGINAL_RETENTION === undefined) delete process.env.LOG_RETENTION_DAYS;
    else process.env.LOG_RETENTION_DAYS = ORIGINAL_RETENTION;
  });

  it('LOG_RETENTION_DAYS <= 0 is the "keep everything" escape hatch — no query is even issued', async () => {
    process.env.LOG_RETENTION_DAYS = '0';
    const runner = new LogPurgeSweepRunner();

    const result = await runner.runSweep(new Date('2026-09-19T00:00:00.000Z'));

    expect(result).toEqual({ enabled: false, companiesProcessed: 0, deleted: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it(
    "purges a company's own expired rows in bounded batches (never one enormous delete), leaves its " +
      "recent rows and another company's recent rows alone, sweeps the instance-level (null-company) " +
      'bucket too, and a second pass resumes exactly where the first left off',
    async () => {
      process.env.LOG_RETENTION_DAYS = '90';
      const now = new Date('2026-09-19T00:00:00.000Z');
      const cutoffMs = now.getTime() - 90 * 24 * 60 * 60 * 1000;

      // Company A: far more expired rows than one batch can take in a single pass — split into two
      // timestamp bands so "oldest first" ordering is independently provable (the OLDER band must be
      // the one gone after exactly one pass, never an arbitrary mix of the two).
      const aOldest = makeRows(
        'company-a',
        'a-oldest',
        LOG_PURGE_BATCH_SIZE,
        cutoffMs - 100 * 24 * 60 * 60 * 1000,
      );
      const aLessOld = makeRows('company-a', 'a-less-old', 500, cutoffMs - 50 * 24 * 60 * 60 * 1000);
      const aRecent = makeRows('company-a', 'a-recent', 1, now.getTime()); // NOT expired — must survive both passes

      // Company B: a small expired backlog of its own, PLUS recent rows — proves company B gets its
      // own turn in the SAME pass (never starved by A's much larger backlog) while its recent rows are
      // never touched.
      const bOld = makeRows('company-b', 'b-old', 3, cutoffMs - 10 * 24 * 60 * 60 * 1000);
      const bRecent = makeRows('company-b', 'b-recent', 2, now.getTime());

      // The instance-level bucket (companyId: null) — a boot-time check spanning every company at
      // once, per `Log.companyId`'s own schema comment — is swept exactly like a real company.
      const instanceLevel = makeRows(null, 'instance', 2, cutoffMs - 5 * 24 * 60 * 60 * 1000);

      const store = installFakeLogStore([
        ...aOldest,
        ...aLessOld,
        ...aRecent,
        ...bOld,
        ...bRecent,
        ...instanceLevel,
      ]);

      const runner = new LogPurgeSweepRunner();

      // ---- Pass 1 ----
      const first = await runner.runSweep(now);

      expect(first.enabled).toBe(true);
      expect(first.companiesProcessed).toBe(3); // company-a, company-b, and the null bucket
      // Exactly ONE company's-worth of overflow got capped this pass: company-a had 1500 expired rows
      // but only LOG_PURGE_BATCH_SIZE of them were deleted; company-b's and the instance bucket's
      // (both well under the cap) were fully cleared in the SAME pass.
      expect(first.deleted).toBe(LOG_PURGE_BATCH_SIZE + bOld.length + instanceLevel.length);

      // Never one enormous delete: every deleteMany call this pass stayed at or under the cap.
      for (const call of deleteMany.mock.calls) {
        expect((call[0] as { where: { id: { in: string[] } } }).where.id.in.length).toBeLessThanOrEqual(
          LOG_PURGE_BATCH_SIZE,
        );
      }

      const afterFirst = store.getRows();
      // The OLDEST band is gone; the LESS-OLD (still expired) band survives this pass — proves
      // oldest-first ordering, not an arbitrary subset.
      expect(afterFirst.some((r) => r.id.startsWith('a-oldest'))).toBe(false);
      expect(afterFirst.filter((r) => r.id.startsWith('a-less-old'))).toHaveLength(500);
      expect(afterFirst.some((r) => r.id.startsWith('a-recent'))).toBe(true); // company A's recent row stays
      expect(afterFirst.some((r) => r.id.startsWith('b-old'))).toBe(false); // company B's expired rows are gone
      expect(afterFirst.filter((r) => r.id.startsWith('b-recent'))).toHaveLength(2); // untouched
      expect(afterFirst.some((r) => r.id.startsWith('instance'))).toBe(false);

      // ---- Pass 2 (same `now` — a resumed run, not a later tick) ----
      deleteMany.mockClear();
      const second = await runner.runSweep(now);

      expect(second.companiesProcessed).toBe(1); // only company-a still had an expired backlog
      expect(second.deleted).toBe(500); // the remaining "less old" band, now fully caught up

      const afterSecond = store.getRows();
      // Nothing expired is left anywhere; every row that survives is one of the three "recent" ones —
      // company A's own, and company B's own, untouched across BOTH passes.
      expect(afterSecond).toHaveLength(3);
      expect(afterSecond.every((r) => r.timestamp.getTime() >= now.getTime())).toBe(true);
    },
  );

  it("one company's batch failing is logged and does not stop the pass from purging the rest", async () => {
    process.env.LOG_RETENTION_DAYS = '90';
    const now = new Date('2026-09-19T00:00:00.000Z');
    const cutoffMs = now.getTime() - 90 * 24 * 60 * 60 * 1000;

    installFakeLogStore([
      ...makeRows('company-a', 'a', 2, cutoffMs - 1000),
      ...makeRows('company-b', 'b', 2, cutoffMs - 1000),
    ]);

    // Company A's own batch select throws once; company B's own call must still go through — a
    // dedicated mockImplementationOnce layered on top of the store's own generic implementation.
    const realFindMany = findMany.getMockImplementation()!;
    findMany.mockImplementation(async (args: { where: { companyId?: string | null } }) => {
      if (args.where.companyId === 'company-a' && !('distinct' in args)) {
        throw new Error('transient DB hiccup');
      }
      return realFindMany(args as never);
    });

    const runner = new LogPurgeSweepRunner();
    const result = await runner.runSweep(now);

    expect(result.companiesProcessed).toBe(2); // discovery still found both
    expect(result.deleted).toBe(2); // only company-b's own 2 rows — company-a's batch failed and was skipped
  });
});
