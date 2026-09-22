/**
 * What this sweep is FOR, proved against real bytes on a real filesystem — never against a spy saying
 * a drain function was called. `DOCUMENTS_ARCHIVE_DIR` is repointed at a fresh `os.tmpdir()` directory
 * per test (the root is re-read on every call precisely so a test can do this — `storage.ts`'s own
 * header), artifacts are written through the same `persistArtifacts` the product writes through, and
 * every assertion below is `existsSync` on the path that function actually returned.
 *
 * The journal is an in-memory stand-in for `PendingStorageErasure` with exactly the three queries this
 * mechanism issues: the drain's own pending read and its per-row update (`company-storage-erasure.ts`),
 * and this runner's own "what is overdue and still on storage" count. Nothing here stands up Redis or
 * BullMQ — the repeatable's own registration is proved separately, against a fake queue, in
 * `queue/document-queue.dispatcher.spec.ts`.
 *
 * ⚖ The decision under test is not plumbing: bytes a statute still requires kept must survive a pass,
 * and must NOT survive the first pass after that statute has run out. The second half is the half that
 * had no mechanism at all before this sweep existed — the drain only ever ran at deletion time, so a
 * row held until 2031 would have stayed on the volume for ever.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

import { extFor, persistArtifacts } from './storage';
import { StorageErasureSweepRunner } from './storage-erasure-sweep-runner';

interface JournalRow {
  id: string;
  companyId: string;
  kind: 'ARCHIVE' | 'INBOUND_PREFIX';
  target: string;
  documentId: string | null;
  retentionUntil: Date | null;
  retentionBasis: string | null;
  erasedAt: Date | null;
  lastError: string | null;
}

let journalRows: JournalRow[];
let nextId: number;

const prismaMock = {
  pendingStorageErasure: {
    findMany: async ({ where }: { where: { erasedAt: null; companyId?: string } }) =>
      journalRows
        .filter((row) => row.erasedAt === null)
        .filter((row) => !where.companyId || row.companyId === where.companyId)
        .map((row) => ({ ...row })),
    update: async ({ where, data }: { where: { id: string }; data: Partial<JournalRow> }) => {
      const row = journalRows.find((candidate) => candidate.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
    // The runner's own backlog count, honoured the way Postgres would honour it rather than
    // short-circuited: pending AND (no declared retention OR a retention date that has passed).
    count: async ({
      where,
    }: {
      where: { erasedAt: null; OR: { retentionUntil: null | { lte: Date } }[] };
    }) => {
      const bound = where.OR.map((clause) => clause.retentionUntil).find(
        (value): value is { lte: Date } => value !== null,
      )!.lte;
      return journalRows.filter(
        (row) =>
          row.erasedAt === null &&
          (row.retentionUntil === null || row.retentionUntil.getTime() <= bound.getTime()),
      ).length;
    },
  },
};

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  get default() {
    return prismaMock;
  },
}));
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const COMPANY = 'co-departed';
const BASIS = 'Commercial 10y (C. com. art. L123-22)';
/** A pass run long after the company itself was deleted — which is the entire point: by now no
 *  company row, no document and no archive row is left anywhere, and only the journal can name these
 *  bytes. */
const NOW = new Date('2026-09-21T03:00:00.000Z');

let archiveDir: string;

/** One real archive on disk plus the journal row that is now its only pointer — the pair the company
 *  deletion left behind. Returns the path of the artifact FILE, so assertions look at the bytes
 *  themselves rather than at the directory containing them. */
async function journalOne(
  documentId: string,
  body: string,
  retention?: { until: Date; basis: string },
): Promise<{ uri: string; file: string; row: JournalRow }> {
  const { uri } = await persistArtifacts(documentId, [
    { role: 'pdf', mime: 'application/pdf', bytes: Buffer.from(body) },
  ]);
  const row: JournalRow = {
    id: `journal-${nextId++}`,
    companyId: COMPANY,
    kind: 'ARCHIVE',
    target: uri,
    documentId,
    retentionUntil: retention?.until ?? null,
    retentionBasis: retention?.basis ?? null,
    erasedAt: null,
    lastError: null,
  };
  journalRows.push(row);
  return { uri, file: join(uri.replace('file://', ''), `pdf.${extFor('application/pdf')}`), row };
}

beforeEach(() => {
  journalRows = [];
  nextId = 1;
  archiveDir = mkdtempSync(join(tmpdir(), 'invoicerr-erasure-sweep-'));
  process.env.DOCUMENTS_ARCHIVE_DIR = archiveDir;
  delete process.env.ARCHIVE_STORAGE;
});

afterEach(() => {
  rmSync(archiveDir, { recursive: true, force: true });
  delete process.env.DOCUMENTS_ARCHIVE_DIR;
  vi.restoreAllMocks();
});

describe('⚖ the sweep erases what a statute has finished holding, and only that', () => {
  it('erases a row whose retention has run out and leaves one whose retention is still running', async () => {
    const expired = await journalOne('doc-expired', 'retention has run', {
      until: new Date('2020-01-01T00:00:00.000Z'),
      basis: BASIS,
    });
    const running = await journalOne('doc-running', 'still under L123-22', {
      until: new Date('2031-12-31T23:59:59.999Z'),
      basis: BASIS,
    });

    const result = await new StorageErasureSweepRunner().runSweep(NOW);

    expect(existsSync(expired.file)).toBe(false);
    expect(expired.row.erasedAt).toEqual(NOW);

    expect(existsSync(running.file)).toBe(true);
    expect(running.row.erasedAt).toBeNull();
    // Held on purpose, with the citation that says why — never recorded as a failure.
    expect(running.row.lastError).toBeNull();
    expect(running.row.retentionBasis).toBe(BASIS);

    expect(result).toEqual({ erased: 1, retained: 1, failed: 0, stuck: 0 });
  });

  it('erases the held bytes on the first pass after the retention period runs out', async () => {
    const held = await journalOne('doc-held', 'held until 2031', {
      until: new Date('2031-12-31T23:59:59.999Z'),
      basis: BASIS,
    });

    // Today's pass: the statute still applies, so the bytes stay — and stay NAMED.
    await expect(new StorageErasureSweepRunner().runSweep(NOW)).resolves.toMatchObject({
      erased: 0,
      retained: 1,
    });
    expect(existsSync(held.file)).toBe(true);

    // A pass on the other side of that date. Before this sweep existed nothing ran here at all: every
    // caller of the drain was a deletion path, and this company's deletion was years in the past.
    const after = await new StorageErasureSweepRunner().runSweep(new Date('2032-01-02T03:00:00.000Z'));

    expect(existsSync(held.file)).toBe(false);
    expect(after).toEqual({ erased: 1, retained: 0, failed: 0, stuck: 0 });
  });

  it('a pass with nothing due erases nothing, and says so rather than staying silent', async () => {
    // A journal whose rows are all already accounted for — the ordinary state of an instance that has
    // had a deletion at some point and nothing overdue since.
    const done = await journalOne('doc-done', 'already gone');
    done.row.erasedAt = new Date('2026-01-01T00:00:00.000Z');
    const logged = vi.spyOn(Logger.prototype, 'log');
    const warned = vi.spyOn(Logger.prototype, 'warn');

    const result = await new StorageErasureSweepRunner().runSweep(NOW);

    expect(result).toEqual({ erased: 0, retained: 0, failed: 0, stuck: 0 });
    // The bytes of an already-erased row are not re-deleted, and the row is not touched a second time.
    expect(done.row.erasedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('nothing due'));
    // An idle pass is never a warning — an operator greps for those to find a real backlog.
    expect(warned).not.toHaveBeenCalled();
  });
});

describe('an object that cannot be erased', () => {
  it('never blocks the rows behind it, is counted as overdue, and does not fail the pass', async () => {
    // An archive written while `ARCHIVE_STORAGE=s3`, on an instance whose S3 settings are no longer
    // present: `deleteArchivedArtifacts` dispatches on the uri's own scheme and the S3 client refuses
    // to build. A real failure of a real provider, not an injected spy — and FIRST in the journal, so
    // "it blocks nothing behind it" is a claim this test can actually make.
    delete process.env.ARCHIVE_S3_REGION;
    delete process.env.ARCHIVE_S3_ACCESS_KEY_ID;
    delete process.env.ARCHIVE_S3_SECRET_ACCESS_KEY;
    journalRows.push({
      id: 'journal-stuck',
      companyId: COMPANY,
      kind: 'ARCHIVE',
      target: 's3://some-bucket/doc-stuck/deadbeef',
      documentId: 'doc-stuck',
      retentionUntil: null,
      retentionBasis: null,
      erasedAt: null,
      lastError: null,
    });
    const healthy = await journalOne('doc-healthy', 'erasable');
    const warned = vi.spyOn(Logger.prototype, 'warn');

    const result = await new StorageErasureSweepRunner().runSweep(NOW);

    // The pass completed normally — a permanently unerasable object is a fact to report, never a
    // reason to abandon the rest of the journal or to report the whole pass as failed.
    expect(result).toEqual({ erased: 1, retained: 0, failed: 1, stuck: 1 });
    expect(existsSync(healthy.file)).toBe(false);

    const stuck = journalRows.find((row) => row.id === 'journal-stuck')!;
    expect(stuck.erasedAt).toBeNull();
    expect(stuck.lastError).toContain('ARCHIVE_S3_REGION');

    // "Is anything overdue and stuck" is answerable from the log level alone.
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('1 overdue and still on storage'));
  });
});
