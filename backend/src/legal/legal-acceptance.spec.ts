import prisma from '@/prisma/prisma.service';

import { getPendingAcceptanceSlugs, recordLegalAcceptance } from './legal-acceptance';
import { currentContentHashOf, getLegalDocument } from './legal-documents';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    legalAcceptance: { upsert: jest.fn(), findMany: jest.fn() },
  },
}));

const upsert = prisma.legalAcceptance.upsert as jest.Mock;
const findMany = prisma.legalAcceptance.findMany as jest.Mock;

const tosVersion = getLegalDocument('terms-of-service')!.version;
const tosHash = currentContentHashOf('terms-of-service')!;
const privacyHash = currentContentHashOf('privacy-policy')!;

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({});
  findMany.mockReset().mockResolvedValue([]);
});

describe('recordLegalAcceptance', () => {
  it('upserts one row per slug, keyed on (userId, documentSlug, contentHash)', async () => {
    await recordLegalAcceptance('user-1', ['terms-of-service', 'privacy-policy'], {
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_documentSlug_contentHash: {
            userId: 'user-1',
            documentSlug: 'terms-of-service',
            contentHash: tosHash,
          },
        },
        create: expect.objectContaining({
          userId: 'user-1',
          documentSlug: 'terms-of-service',
          version: tosVersion,
          contentHash: tosHash,
          ipAddress: '1.2.3.4',
          userAgent: 'jest',
        }),
        update: {},
      }),
    );
  });

  it('silently skips an unknown slug rather than upserting garbage', async () => {
    await recordLegalAcceptance('user-1', ['not-a-real-document']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('defaults ip/user-agent to null when no meta is given', async () => {
    await recordLegalAcceptance('user-1', ['terms-of-service']);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ipAddress: null, userAgent: null }) }),
    );
  });
});

describe('getPendingAcceptanceSlugs', () => {
  it('returns both required slugs when the user has accepted nothing', async () => {
    findMany.mockResolvedValue([]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual([
      'terms-of-service',
      'privacy-policy',
    ]);
  });

  it('excludes a slug accepted at its current content hash', async () => {
    findMany.mockResolvedValue([{ documentSlug: 'terms-of-service', contentHash: tosHash }]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual(['privacy-policy']);
  });

  it('treats an acceptance at a STALE hash as still pending, even at the CURRENT version string', async () => {
    // The whole point of decision 2026-09-17: two text edits can share a version string (an author
    // forgetting to bump it a second time on the same day) — the hash must catch what version can't.
    findMany.mockResolvedValue([
      { documentSlug: 'terms-of-service', contentHash: 'stale-hash-not-matching-current-content' },
      { documentSlug: 'privacy-policy', contentHash: privacyHash },
    ]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual(['terms-of-service']);
  });

  it('treats a pre-migration row (contentHash: null) as still pending, never grandfathered in', async () => {
    findMany.mockResolvedValue([
      { documentSlug: 'terms-of-service', contentHash: null },
      { documentSlug: 'privacy-policy', contentHash: privacyHash },
    ]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual(['terms-of-service']);
  });

  it('returns an empty list once both are accepted at their current content hash', async () => {
    findMany.mockResolvedValue([
      { documentSlug: 'terms-of-service', contentHash: tosHash },
      { documentSlug: 'privacy-policy', contentHash: privacyHash },
    ]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual([]);
  });
});
