/**
 * Proves the whole point of this module against REAL BYTES ON A REAL FILESYSTEM — never against a
 * spy saying a delete function was called. `DOCUMENTS_ARCHIVE_DIR` and `DOCUMENTS_INBOUND_DIR` are
 * repointed at a fresh `os.tmpdir()` directory per test (both roots are re-read on every call
 * precisely so a test can do this — see `storage.ts#archiveRoot`'s own header), files are written
 * through the same `persistArtifacts`/`persistInboundFile` the product writes through, and every
 * assertion below is `existsSync` on the path those functions actually returned.
 *
 * The database is an in-memory stand-in with ONE behavior that matters: `company.delete` drops this
 * company's `DocumentArchive` rows, exactly as the real `onDelete: Cascade` chain
 * (`Company` → `DocumentInstance` → `DocumentArchive`) does. That cascade is the entire defect — it
 * takes the `uri` column, the only pointer to the bytes, with it — so a fake that did not reproduce
 * it would prove nothing.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { deleteCompanyPermanently, deleteCompanyPermanentlyNow } from '@/modules/billing/deletion';

import { drainStorageErasureJournal } from './company-storage-erasure';
import { extFor, persistArtifacts } from './storage';
import { persistInboundFile } from '../received-invoices/storage';

interface ArchiveRow {
  id: string;
  companyId: string;
  documentId: string;
  uri: string;
  retentionUntil: Date | null;
  retentionBasis: string | null;
}

interface JournalRow {
  id: string;
  companyId: string;
  kind: 'ARCHIVE' | 'INBOUND_PREFIX';
  target: string;
  documentId: string | null;
  retentionUntil: Date | null;
  retentionBasis: string | null;
  journaledAt: Date;
  erasedAt: Date | null;
  lastError: string | null;
}

let archiveRows: ArchiveRow[];
let journalRows: JournalRow[];
let subscriptionRow: { polarSubscriptionId: string | null; status: string; deletionDueAt: Date } | null;
/** Set by a test that wants the process to "die" at a chosen point — see the crash case below. */
let journalReadFails: string | null;
let nextId: number;

const prismaMock = {
  companySubscription: { findUnique: async () => subscriptionRow },
  webhook: { deleteMany: async () => ({ count: 0 }) },
  company: {
    delete: async ({ where }: { where: { id: string } }) => {
      // THE CASCADE. `DocumentArchive` goes, `uri` with it — and `PendingStorageErasure` deliberately
      // does NOT, because its `companyId` is a plain column and not a foreign key.
      archiveRows = archiveRows.filter((row) => row.companyId !== where.id);
      return { id: where.id };
    },
  },
  documentArchive: {
    findMany: async ({ where }: { where: { companyId: string } }) =>
      archiveRows.filter((row) => row.companyId === where.companyId).map((row) => ({ ...row })),
  },
  pendingStorageErasure: {
    createMany: async ({
      data,
    }: {
      data: Omit<JournalRow, 'id' | 'journaledAt' | 'erasedAt' | 'lastError' | 'documentId'>[];
    }) => {
      let count = 0;
      for (const entry of data as (Partial<JournalRow> &
        Pick<JournalRow, 'companyId' | 'kind' | 'target'>)[]) {
        const duplicate = journalRows.some(
          (row) =>
            row.companyId === entry.companyId && row.kind === entry.kind && row.target === entry.target,
        );
        if (duplicate) continue; // `skipDuplicates: true`
        journalRows.push({
          id: `journal-${nextId++}`,
          companyId: entry.companyId,
          kind: entry.kind,
          target: entry.target,
          documentId: entry.documentId ?? null,
          retentionUntil: entry.retentionUntil ?? null,
          retentionBasis: entry.retentionBasis ?? null,
          journaledAt: new Date(),
          erasedAt: null,
          lastError: null,
        });
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: { where: { erasedAt: null; companyId?: string } }) => {
      if (journalReadFails) throw new Error(journalReadFails);
      return journalRows
        .filter((row) => row.erasedAt === null)
        .filter((row) => !where.companyId || row.companyId === where.companyId)
        .map((row) => ({ ...row }));
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<JournalRow> }) => {
      const row = journalRows.find((candidate) => candidate.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
  },
  $transaction: async (fn: (tx: unknown) => unknown) => fn(prismaMock),
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

const COMPANY = 'co-erasure';
const NEVER_PAID = { subscriptions: { revoke: async () => ({}) } };

let archiveDir: string;
let inboundDir: string;

/** One real archive on disk plus the `DocumentArchive` row that points at it — the pair the cascade
 *  is about to break apart. Returns the path of the artifact FILE, so an assertion can look at the
 *  bytes themselves rather than at the directory that contains them. */
async function archiveOne(
  documentId: string,
  body: string,
  retention?: { until: Date; basis: string },
): Promise<{ uri: string; file: string }> {
  const { uri } = await persistArtifacts(documentId, [
    { role: 'pdf', mime: 'application/pdf', bytes: Buffer.from(body) },
  ]);
  archiveRows.push({
    id: `archive-${nextId++}`,
    companyId: COMPANY,
    documentId,
    uri,
    retentionUntil: retention?.until ?? null,
    retentionBasis: retention?.basis ?? null,
  });
  return { uri, file: join(uri.replace('file://', ''), `pdf.${extFor('application/pdf')}`) };
}

async function uploadOne(body: string): Promise<string> {
  const sha256 = createHash('sha256').update(body).digest('hex');
  await persistInboundFile(COMPANY, sha256, 'application/pdf', Buffer.from(body));
  return join(inboundDir, COMPANY, `${sha256}.pdf`);
}

beforeEach(() => {
  archiveRows = [];
  journalRows = [];
  subscriptionRow = null;
  journalReadFails = null;
  nextId = 1;
  archiveDir = mkdtempSync(join(tmpdir(), 'invoicerr-erasure-archive-'));
  inboundDir = mkdtempSync(join(tmpdir(), 'invoicerr-erasure-inbound-'));
  process.env.DOCUMENTS_ARCHIVE_DIR = archiveDir;
  process.env.DOCUMENTS_INBOUND_DIR = inboundDir;
  delete process.env.ARCHIVE_STORAGE;
  delete process.env.INBOUND_STORAGE;
});

afterEach(() => {
  rmSync(archiveDir, { recursive: true, force: true });
  rmSync(inboundDir, { recursive: true, force: true });
  delete process.env.DOCUMENTS_ARCHIVE_DIR;
  delete process.env.DOCUMENTS_INBOUND_DIR;
});

describe('deleting a company erases the bytes it owns, not only the rows', () => {
  it('removes every archived artifact and every inbound upload from storage', async () => {
    const first = await archiveOne('doc-1', 'invoice one');
    const second = await archiveOne('doc-2', 'invoice two');
    const upload = await uploadOne('a supplier PDF');
    expect([first.file, second.file, upload].every(existsSync)).toBe(true);

    await deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID);

    expect(existsSync(first.file)).toBe(false);
    expect(existsSync(second.file)).toBe(false);
    expect(existsSync(upload)).toBe(false);
    // Not merely the files: the whole company-prefixed inbound directory, which is what that store
    // deletes by, and the archive directories, which is what this one deletes by.
    expect(existsSync(join(inboundDir, COMPANY))).toBe(false);
    expect(existsSync(first.uri.replace('file://', ''))).toBe(false);
  });

  it('erases on the AUTOMATED billing-sweep path too, not only the OWNER-initiated one', async () => {
    const now = new Date('2026-09-21T10:00:00.000Z');
    subscriptionRow = {
      polarSubscriptionId: null,
      status: 'ZIPPED',
      deletionDueAt: new Date('2026-09-20T00:00:00.000Z'),
    };
    const archived = await archiveOne('doc-swept', 'swept away');
    const upload = await uploadOne('swept upload');

    await expect(deleteCompanyPermanently(COMPANY, now, NEVER_PAID)).resolves.toBe(true);

    expect(existsSync(archived.file)).toBe(false);
    expect(existsSync(upload)).toBe(false);
  });

  it('touches nothing belonging to a company it was not asked to delete', async () => {
    const mine = await archiveOne('doc-mine', 'mine');
    const { uri: theirUri } = await persistArtifacts('doc-theirs', [
      { role: 'pdf', mime: 'application/pdf', bytes: Buffer.from('theirs') },
    ]);
    archiveRows.push({
      id: 'archive-other',
      companyId: 'some-other-company',
      documentId: 'doc-theirs',
      uri: theirUri,
      retentionUntil: null,
      retentionBasis: null,
    });
    const theirFile = join(theirUri.replace('file://', ''), 'pdf.pdf');

    await deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID);

    expect(existsSync(mine.file)).toBe(false);
    expect(existsSync(theirFile)).toBe(true);
  });

  it('refuses to journal — and so never erases — a company the stale-read guard declined to delete', async () => {
    const now = new Date('2026-09-21T10:00:00.000Z');
    // A webhook reactivated this subscription between the sweep's snapshot and this call.
    subscriptionRow = {
      polarSubscriptionId: null,
      status: 'ACTIVE',
      deletionDueAt: new Date('2026-09-20T00:00:00.000Z'),
    };
    const stillLive = await archiveOne('doc-reprieved', 'still a customer');

    await expect(deleteCompanyPermanently(COMPANY, now, NEVER_PAID)).resolves.toBe(false);

    expect(existsSync(stillLive.file)).toBe(true);
    expect(journalRows).toHaveLength(0);
  });
});

describe('a crash between the commit and the erasure', () => {
  it('leaves a journal an operator can act on — and a later pass finishes the job', async () => {
    const first = await archiveOne('doc-1', 'invoice one');
    const second = await archiveOne('doc-2', 'invoice two');
    const upload = await uploadOne('a supplier PDF');
    // The process dies the instant the deletion transaction commits: the very first thing the
    // erasure does afterwards — reading its own journal — never returns.
    journalReadFails = 'connection terminated unexpectedly';

    await deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID);

    // The rows are gone for good. Before this module existed, that was the end of the story: three
    // files on the volume and nothing left in the database able to name them.
    expect(archiveRows).toHaveLength(0);
    expect([first.file, second.file, upload].every(existsSync)).toBe(true);

    // What the crash actually left: a query, not silence.
    const pending = journalRows.filter((row) => row.erasedAt === null);
    expect(pending.map((row) => row.target).sort()).toEqual([COMPANY, first.uri, second.uri].sort());
    expect(pending.every((row) => row.companyId === COMPANY)).toBe(true);

    // The operator (or the next boot, or a sweep) drains it — with no company row, no document and no
    // archive row left anywhere, the journal alone is enough to find every byte.
    journalReadFails = null;
    await expect(drainStorageErasureJournal()).resolves.toMatchObject({ erased: 3, failed: 0 });

    expect(existsSync(first.file)).toBe(false);
    expect(existsSync(second.file)).toBe(false);
    expect(existsSync(upload)).toBe(false);
    expect(journalRows.every((row) => row.erasedAt !== null)).toBe(true);
  });

  it('one object that cannot be deleted never blocks the others, and stays named with its error', async () => {
    const healthy = await archiveOne('doc-1', 'invoice one');
    // An archive written while `ARCHIVE_STORAGE=s3`, on an instance whose S3 settings are no longer
    // present: `deleteArchivedArtifacts` dispatches on the uri's own scheme and the S3 client refuses
    // to build. A real failure of a real provider, not an injected spy.
    delete process.env.ARCHIVE_S3_REGION;
    delete process.env.ARCHIVE_S3_ACCESS_KEY_ID;
    delete process.env.ARCHIVE_S3_SECRET_ACCESS_KEY;
    archiveRows.push({
      id: 'archive-s3',
      companyId: COMPANY,
      documentId: 'doc-2',
      uri: 's3://some-bucket/doc-2/deadbeef',
      retentionUntil: null,
      retentionBasis: null,
    });

    await deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID);

    expect(existsSync(healthy.file)).toBe(false);
    const stuck = journalRows.find((row) => row.target.startsWith('s3://'))!;
    expect(stuck.erasedAt).toBeNull();
    expect(stuck.lastError).toContain('ARCHIVE_S3_REGION');
  });
});

describe('⚖ statutory retention versus an erasure request', () => {
  const RETAINED_UNTIL = new Date('2031-12-31T23:59:59.999Z');
  const BASIS = 'Commercial 10y (C. com. art. L123-22)';

  it('keeps bytes a statute still requires kept, and says which statute in the journal', async () => {
    const retained = await archiveOne('doc-retained', 'still under L123-22', {
      until: RETAINED_UNTIL,
      basis: BASIS,
    });
    const expired = await archiveOne('doc-expired', 'retention has run', {
      until: new Date('2020-01-01T00:00:00.000Z'),
      basis: BASIS,
    });

    await deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID);

    expect(existsSync(retained.file)).toBe(true);
    expect(existsSync(expired.file)).toBe(false);

    const held = journalRows.find((row) => row.target === retained.uri)!;
    expect(held.erasedAt).toBeNull();
    expect(held.retentionUntil).toEqual(RETAINED_UNTIL);
    expect(held.retentionBasis).toBe(BASIS);
    expect(held.lastError).toBeNull(); // held on purpose — never reported as a failure
  });

  it('never blocks the deletion itself: the company still goes, and the exit is not refused', async () => {
    await archiveOne('doc-retained', 'still retained', { until: RETAINED_UNTIL, basis: BASIS });

    await expect(deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID)).resolves.toBeUndefined();
    expect(archiveRows).toHaveLength(0);
  });

  it('erases the held bytes once the retention period has actually elapsed', async () => {
    const retained = await archiveOne('doc-retained', 'held for now', {
      until: RETAINED_UNTIL,
      basis: BASIS,
    });

    await deleteCompanyPermanentlyNow(COMPANY, NEVER_PAID);
    expect(existsSync(retained.file)).toBe(true);

    await drainStorageErasureJournal({ now: new Date('2032-01-01T00:00:00.000Z') });

    expect(existsSync(retained.file)).toBe(false);
  });
});
