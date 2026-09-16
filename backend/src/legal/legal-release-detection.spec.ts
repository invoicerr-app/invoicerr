import prisma from '@/prisma/prisma.service';

import { detectAndRecordNewLegalReleases } from './legal-release-detection';
import { currentContentHashOf, listLegalDocuments } from './legal-documents';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    legalDocumentRelease: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
  },
}));

const findUnique = prisma.legalDocumentRelease.findUnique as jest.Mock;
const count = prisma.legalDocumentRelease.count as jest.Mock;
const create = prisma.legalDocumentRelease.create as jest.Mock;

const docs = listLegalDocuments();
const tosHash = currentContentHashOf('terms-of-service')!;

beforeEach(() => {
  findUnique.mockReset();
  count.mockReset();
  create.mockReset().mockResolvedValue({});
});

describe('detectAndRecordNewLegalReleases', () => {
  it('records every document as BOOTSTRAPPED on a fresh table (no prior release for any slug)', async () => {
    findUnique.mockResolvedValue(null);
    count.mockResolvedValue(0);

    const summary = await detectAndRecordNewLegalReleases();

    expect(summary.bootstrapped.map((d) => d.slug).sort()).toEqual(docs.map((d) => d.slug).sort());
    expect(summary.changed).toEqual([]);
    expect(create).toHaveBeenCalledTimes(docs.length);
  });

  it('creates a release ONCE for an unchanged document — a second run is a no-op', async () => {
    // First run: nothing on file yet for any of the five documents.
    findUnique.mockResolvedValue(null);
    count.mockResolvedValue(0);
    await detectAndRecordNewLegalReleases();
    expect(create).toHaveBeenCalledTimes(docs.length);

    // Second run against the SAME content: every exact (slug, contentHash) is now on file.
    create.mockClear();
    findUnique.mockResolvedValue({ id: 'release-1', slug: 'terms-of-service', contentHash: tosHash });
    const summary = await detectAndRecordNewLegalReleases();

    expect(create).not.toHaveBeenCalled();
    expect(summary.bootstrapped).toEqual([]);
    expect(summary.changed).toEqual([]);
  });

  it('reports a document as CHANGED (not bootstrapped) when a prior release already existed', async () => {
    findUnique.mockResolvedValue(null); // this exact hash was never recorded before...
    count.mockResolvedValue(1); // ...but an OLDER release for this slug already exists.

    const summary = await detectAndRecordNewLegalReleases();

    expect(summary.changed.map((d) => d.slug).sort()).toEqual(docs.map((d) => d.slug).sort());
    expect(summary.bootstrapped).toEqual([]);
    expect(create).toHaveBeenCalledTimes(docs.length);
  });

  it('treats a revert back to a previously-shipped exact text as a no-op, not a new release', async () => {
    // The (slug, contentHash) pair is already on file, even though it isn't the LATEST one
    // chronologically — findUnique matching at all is what this function checks.
    findUnique.mockResolvedValue({ id: 'old-release', slug: 'terms-of-service', contentHash: tosHash });

    const summary = await detectAndRecordNewLegalReleases();

    expect(create).not.toHaveBeenCalled();
    expect(summary.changed).toEqual([]);
    expect(summary.bootstrapped).toEqual([]);
  });
});
