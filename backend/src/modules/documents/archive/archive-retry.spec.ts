/**
 * The whole path a failed legal archiving now takes, end to end: the send that could not preserve
 * what it just delivered (`archive-on-send.ts`), the journal that keeps the artifacts
 * (`pending-archive.ts`), and the sweep that keeps trying and — when trying stops being enough —
 * tells someone (`archive-retry-sweep-runner.ts`).
 *
 * Both halves run against ONE in-memory stand-in for the two tables involved, rather than two
 * independently mocked halves: what is being proven is that bytes journaled by the send path are the
 * bytes a later pass archives, which a per-half mock would assert away. Only `createDocumentArchive`
 * — the storage/Prisma boundary this suite is not about — is mocked, so that "the archive store is
 * down, then it comes back" is something a test can actually stage.
 */
import { vi, type Mock } from 'vitest';

import { archiveDeliveredArtifactsIfAny } from './archive-on-send';
import { ArchiveRetrySweepRunner } from './archive-retry-sweep-runner';
import { ArchivedArtifactInput } from './hashing';
import { createDocumentArchive } from './persistence';

interface FakePendingRow {
  id: string;
  companyId: string;
  documentId: string;
  artifacts: unknown;
  firstFailedAt: Date;
  attempts: number;
  lastError: string;
  nextAttemptAt: Date;
  escalatedAt: Date | null;
}

interface FakeDocumentRow {
  id: string;
  typeId: string;
  displayNumber: string | null;
  lastArchiveError: string | null;
}

interface FakeLogRow {
  level: string;
  category: string;
  message: string;
  companyId: string | null;
  details: Record<string, unknown>;
}

// `vi.hoisted` because `vi.mock`'s factory below is hoisted above every ordinary `const` in this
// file — the same reason `invitations.controller.spec.ts` uses it. The three collections ARE the
// database for this suite: both the send path and the sweep write into them.
const db = vi.hoisted(() => ({
  pending: new Map<string, FakePendingRow>(),
  documents: new Map<string, FakeDocumentRow>(),
  logs: [] as FakeLogRow[],
  nextId: 0,
}));

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    pendingDocumentArchive: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { documentId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = db.pending.get(where.documentId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          db.nextId += 1;
          const row = { id: `pending-${db.nextId}`, ...create } as unknown as FakePendingRow;
          db.pending.set(where.documentId, row);
          return row;
        },
      ),
      findMany: vi.fn(async ({ where, take }: { where: { nextAttemptAt: { lte: Date } }; take: number }) => {
        return [...db.pending.values()]
          .filter((row) => row.nextAttemptAt.getTime() <= where.nextAttemptAt.lte.getTime())
          .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
          .slice(0, take)
          .map((row) => ({ ...row, document: db.documents.get(row.documentId) ?? null }));
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...db.pending.values()].find((candidate) => candidate.id === where.id);
        if (!row) throw new Error(`No pending archive "${where.id}".`);
        Object.assign(row, data);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { documentId: string } }) => {
        const deleted = db.pending.delete(where.documentId);
        return { count: deleted ? 1 : 0 };
      }),
      count: vi.fn(async () => db.pending.size),
    },
    documentInstance: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.documents.get(where.id);
        if (!row) throw new Error(`No document "${where.id}".`);
        Object.assign(row, data);
        return row;
      }),
    },
    log: {
      create: vi.fn(async ({ data }: { data: FakeLogRow }) => {
        db.logs.push(data);
        return data;
      }),
    },
  },
}));

vi.mock('./persistence');

const mockedCreateArchive = createDocumentArchive as Mock;

const COMPANY = 'company-1';
const DOCUMENT = 'doc-1';
/** The bytes a transport actually delivered — a PDF and the structured file deposited beside it, the
 *  shape `send-document-email.ts`/the PDP transport hand to archiving. */
const DELIVERED: ArchivedArtifactInput[] = [
  { role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]) },
  { role: 'facturx', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
];

function seedDocument(): void {
  db.documents.set(DOCUMENT, {
    id: DOCUMENT,
    typeId: 'invoice',
    displayNumber: 'INV-2026-0042',
    lastArchiveError: null,
  });
}

/** ERROR-level rows only — the level this path reserves for "a human has to look at this". A
 *  failure that is merely journaled for retry is a WARN (`archive-on-send.ts`), so counting these is
 *  exactly counting the alerts. */
function errorLogs(): FakeLogRow[] {
  return db.logs.filter((row) => row.level === 'ERROR');
}

const T0 = new Date('2026-09-21T10:00:00.000Z');
const minutes = (count: number): Date => new Date(T0.getTime() + count * 60_000);

describe('a legal archiving failure is retried, and stops being silent when retrying is not enough', () => {
  let runner: ArchiveRetrySweepRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    // `Date` only — nothing here waits on a timer, and faking those too would freeze the `await`s
    // this suite is made of. The send path takes its own clock from `new Date()` (it is called from a
    // real delivery, not from a sweep), so pinning the system date is what puts its journaled
    // deadline on the same timeline as the `now` every `runSweep` below is given.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    db.pending.clear();
    db.documents.clear();
    db.logs.length = 0;
    db.nextId = 0;
    seedDocument();
    runner = new ArchiveRetrySweepRunner();
  });

  afterEach(() => vi.useRealTimers());

  it('keeps the delivered artifacts when the archive store refuses them', async () => {
    mockedCreateArchive.mockRejectedValue(new Error('S3 503 SlowDown'));

    await archiveDeliveredArtifactsIfAny({
      companyId: COMPANY,
      documentId: DOCUMENT,
      artifacts: DELIVERED,
    });

    const journaled = db.pending.get(DOCUMENT);
    expect(journaled).toBeDefined();
    expect(journaled?.attempts).toBe(1);
    expect(journaled?.lastError).toBe('S3 503 SlowDown');
    // The bytes themselves, not a pointer to them: nothing else in this system holds what was
    // actually delivered once the send job's own memory is gone.
    expect(journaled?.artifacts).toEqual([
      {
        role: 'pdf',
        mime: 'application/pdf',
        bytesBase64: Buffer.from(DELIVERED[0].bytes).toString('base64'),
      },
      {
        role: 'facturx',
        mime: 'application/pdf',
        bytesBase64: Buffer.from(DELIVERED[1].bytes).toString('base64'),
      },
    ]);
    expect(db.documents.get(DOCUMENT)?.lastArchiveError).toBe('S3 503 SlowDown');
  });

  it('archives nothing extra, and journals nothing, when the first attempt succeeds', async () => {
    mockedCreateArchive.mockResolvedValue({ id: 'archive-1' });

    await archiveDeliveredArtifactsIfAny({
      companyId: COMPANY,
      documentId: DOCUMENT,
      artifacts: DELIVERED,
    });

    expect(db.pending.size).toBe(0);
    expect(db.documents.get(DOCUMENT)?.lastArchiveError).toBeNull();
  });

  it('retries a transient failure and eventually archives the very bytes that were delivered', async () => {
    mockedCreateArchive.mockRejectedValue(new Error('S3 503 SlowDown'));
    await archiveDeliveredArtifactsIfAny({
      companyId: COMPANY,
      documentId: DOCUMENT,
      artifacts: DELIVERED,
    });

    // Before the backoff has elapsed the row is not even looked at — the schedule is the schedule,
    // not "whatever the sweep happens to see".
    const tooEarly = await runner.runSweep(new Date(T0.getTime() + 30_000));
    expect(tooEarly.attempted).toBe(0);
    expect(db.pending.size).toBe(1);

    // The outage clears.
    mockedCreateArchive.mockResolvedValue({ id: 'archive-1' });
    const result = await runner.runSweep(minutes(2));

    expect(result).toMatchObject({ attempted: 1, archived: 1, failed: 0, escalated: 0, pending: 0 });
    expect(mockedCreateArchive).toHaveBeenLastCalledWith({
      companyId: COMPANY,
      documentId: DOCUMENT,
      // Round-tripped through the journal's base64 and back to the exact delivered bytes — an
      // archive of anything else would hash to something the delivery never produced.
      artifacts: DELIVERED,
    });
    // The work is done: nothing left owed, and the document no longer claims a gap.
    expect(db.pending.size).toBe(0);
    expect(db.documents.get(DOCUMENT)?.lastArchiveError).toBeNull();
    // And it recovered without ever alarming anyone — this is the "visible but harmless" failure
    // that must never be manufactured.
    expect(errorLogs()).toHaveLength(0);
  });

  it('leaves a findable trace naming the document once retrying stops being enough', async () => {
    mockedCreateArchive.mockRejectedValue(new Error('ENOSPC: no space left on device'));
    await archiveDeliveredArtifactsIfAny({
      companyId: COMPANY,
      documentId: DOCUMENT,
      artifacts: DELIVERED,
    });

    // Attempts 2, 3 and 4 — still treated as an outage that might clear: rescheduled, counted, and
    // deliberately quiet.
    for (const pass of [1, 2, 3]) {
      const result = await runner.runSweep(minutes(pass * 120));
      expect(result).toMatchObject({ attempted: 1, archived: 0, failed: 1, escalated: 0, pending: 1 });
      expect(errorLogs()).toHaveLength(0);
      expect(db.documents.get(DOCUMENT)?.lastArchiveError).toBe('ENOSPC: no space left on device');
    }

    // Attempt 5 crosses the threshold.
    const escalation = await runner.runSweep(minutes(480));
    expect(escalation).toMatchObject({ attempted: 1, failed: 1, escalated: 1, pending: 1 });

    // WHAT THE COMPANY SEES, on the document itself — a sentence, not a driver message: the invoice
    // is named, the gap is stated, the cause is still there for whoever can fix it.
    const shown = db.documents.get(DOCUMENT)?.lastArchiveError ?? '';
    expect(shown).toContain('INV-2026-0042');
    expect(shown).toContain('NO legal archive');
    expect(shown).toContain('5 archiving attempts');
    expect(shown).toContain('ENOSPC: no space left on device');

    // WHAT AN OPERATOR SEES — one persisted, company-scoped ERROR row, naming the document rather
    // than merely reporting that something somewhere failed.
    expect(errorLogs()).toHaveLength(1);
    const alert = errorLogs()[0];
    expect(alert.companyId).toBe(COMPANY);
    expect(alert.category).toBe('documents');
    expect(alert.message).toContain('NO archive');
    expect(alert.details).toMatchObject({
      documentId: DOCUMENT,
      typeId: 'invoice',
      displayNumber: 'INV-2026-0042',
      attempts: 5,
      firstFailedAt: T0.toISOString(),
    });

    // The bytes are STILL there: escalating is telling someone, never giving up on the only copy of
    // an artifact a tax authority may ask for.
    expect(db.pending.get(DOCUMENT)?.artifacts).toBeDefined();
    expect(db.pending.get(DOCUMENT)?.escalatedAt).toEqual(minutes(480));
  });

  it('alerts once per document, not once per pass — and keeps retrying afterwards', async () => {
    mockedCreateArchive.mockRejectedValue(new Error('ENOSPC: no space left on device'));
    await archiveDeliveredArtifactsIfAny({
      companyId: COMPANY,
      documentId: DOCUMENT,
      artifacts: DELIVERED,
    });
    for (const pass of [1, 2, 3, 4, 5, 6, 7]) {
      await runner.runSweep(minutes(pass * 120));
    }

    // Eight failed attempts, exactly one alert — a daily error per broken document would be the
    // noise that trains people to stop reading them.
    expect(db.pending.get(DOCUMENT)?.attempts).toBe(8);
    expect(errorLogs()).toHaveLength(1);

    // And the store coming back a week later still closes the gap on its own.
    mockedCreateArchive.mockResolvedValue({ id: 'archive-late' });
    const recovered = await runner.runSweep(minutes(60 * 24 * 7));
    expect(recovered).toMatchObject({ archived: 1, pending: 0 });
    expect(db.documents.get(DOCUMENT)?.lastArchiveError).toBeNull();
  });
});
