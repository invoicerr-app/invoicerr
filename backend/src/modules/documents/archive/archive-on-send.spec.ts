import { vi, type Mock } from 'vitest';
import prisma from '@/prisma/prisma.service';

import { archiveDeliveredArtifactsIfAny } from './archive-on-send';
import { createDocumentArchive } from './persistence';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentInstance: { update: vi.fn() },
    // The retry journal (`pending-archive.ts`, which is deliberately NOT mocked here — what this
    // file has to prove is that a failed archiving really does hand the ARTIFACTS on, and a mocked
    // journal would assert exactly that away).
    pendingDocumentArchive: { upsert: vi.fn().mockResolvedValue({}), deleteMany: vi.fn() },
    // Read by `logger.error()` (logger.service.ts) whenever this module logs a failure — mocked out
    // so those (expected) failure-path tests below don't also spam a "log entry could not be
    // persisted" error of their own.
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('./persistence');

const updateDocument = prisma.documentInstance.update as Mock;
const journalArchive = prisma.pendingDocumentArchive.upsert as Mock;
const dropJournaled = prisma.pendingDocumentArchive.deleteMany as Mock;
const createArchive = createDocumentArchive as Mock;

describe('archiveDeliveredArtifactsIfAny', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journalArchive.mockResolvedValue({});
    dropJournaled.mockResolvedValue({ count: 0 });
  });

  it('does nothing at all when no artifacts were delivered (e.g. the credit note’s "send")', async () => {
    await archiveDeliveredArtifactsIfAny({ companyId: 'c', documentId: 'd', artifacts: undefined });
    await archiveDeliveredArtifactsIfAny({ companyId: 'c', documentId: 'd', artifacts: [] });

    expect(createArchive).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('archives the delivered artifacts and clears a stale lastArchiveError on success', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }];
    createArchive.mockResolvedValue({ id: 'archive-1' });

    await archiveDeliveredArtifactsIfAny({ companyId: 'company-1', documentId: 'doc-1', artifacts });

    expect(createArchive).toHaveBeenCalledWith({ companyId: 'company-1', documentId: 'doc-1', artifacts });
    expect(updateDocument).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { lastArchiveError: null },
    });
    // Nothing is owed any more: an earlier attempt's journal row (if any) goes with the success, so
    // no later sweep pass re-archives a document that is already preserved.
    expect(dropJournaled).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } });
    expect(journalArchive).not.toHaveBeenCalled();
  });

  it('never throws when archiving fails — logs it and records lastArchiveError instead', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1]) }];
    createArchive.mockRejectedValue(new Error('disk full'));
    updateDocument.mockResolvedValue({});

    await expect(
      archiveDeliveredArtifactsIfAny({ companyId: 'company-1', documentId: 'doc-1', artifacts }),
    ).resolves.toBeUndefined();

    expect(updateDocument).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { lastArchiveError: 'disk full' },
    });
  });

  it('keeps the delivered artifacts for the retry sweep rather than dropping them', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }];
    createArchive.mockRejectedValue(new Error('disk full'));
    updateDocument.mockResolvedValue({});

    await archiveDeliveredArtifactsIfAny({ companyId: 'company-1', documentId: 'doc-1', artifacts });

    // These bytes exist nowhere else — `deliver()`'s own result is the only copy, and this call is
    // the last code that ever holds it. Without this write there is nothing left for any retry to
    // archive, which is exactly why the failure used to be terminal however loudly it was logged.
    expect(journalArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId: 'doc-1' },
        create: expect.objectContaining({
          companyId: 'company-1',
          documentId: 'doc-1',
          attempts: 1,
          lastError: 'disk full',
          artifacts: [{ role: 'pdf', mime: 'application/pdf', bytesBase64: 'AQID' }],
        }),
      }),
    );
  });

  it('never throws even when the compensating write ALSO fails (e.g. the DB is down)', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1]) }];
    createArchive.mockRejectedValue(new Error('disk full'));
    // The whole database is gone — the journal write and the document write both go with it, and
    // the delivery that already happened must still stand.
    journalArchive.mockRejectedValue(new Error('db unreachable'));
    updateDocument.mockRejectedValue(new Error('db unreachable'));

    await expect(
      archiveDeliveredArtifactsIfAny({ companyId: 'company-1', documentId: 'doc-1', artifacts }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the archive was written and only the bookkeeping after it failed', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1]) }];
    createArchive.mockResolvedValue({ id: 'archive-1' });
    dropJournaled.mockRejectedValue(new Error('db unreachable'));

    await expect(
      archiveDeliveredArtifactsIfAny({ companyId: 'company-1', documentId: 'doc-1', artifacts }),
    ).resolves.toBeUndefined();

    // The archive EXISTS: journaling these artifacts again would have the next sweep pass archive
    // the very same delivery a second time.
    expect(journalArchive).not.toHaveBeenCalled();
  });
});
