import prisma from '@/prisma/prisma.service';

import { archiveDeliveredArtifactsIfAny } from './archive-on-send';
import { createDocumentArchive } from './persistence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentInstance: { update: jest.fn() },
    // Read by `logger.error()` (logger.service.ts) whenever this module logs a failure — mocked out
    // so those (expected) failure-path tests below don't also spam a "log entry could not be
    // persisted" error of their own.
    log: { create: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock('./persistence');

const updateDocument = prisma.documentInstance.update as jest.Mock;
const createArchive = createDocumentArchive as jest.Mock;

describe('archiveDeliveredArtifactsIfAny', () => {
  beforeEach(() => jest.clearAllMocks());

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

  it('never throws even when the compensating write ALSO fails (e.g. the DB is down)', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1]) }];
    createArchive.mockRejectedValue(new Error('disk full'));
    updateDocument.mockRejectedValue(new Error('db unreachable'));

    await expect(
      archiveDeliveredArtifactsIfAny({ companyId: 'company-1', documentId: 'doc-1', artifacts }),
    ).resolves.toBeUndefined();
  });
});
