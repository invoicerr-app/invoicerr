import prisma from '@/prisma/prisma.service';

import { getPendingAcceptanceSlugs, recordLegalAcceptance } from './legal-acceptance';
import { currentVersionOf } from './legal-documents';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    legalAcceptance: { upsert: jest.fn(), findMany: jest.fn() },
  },
}));

const upsert = prisma.legalAcceptance.upsert as jest.Mock;
const findMany = prisma.legalAcceptance.findMany as jest.Mock;

const tosVersion = currentVersionOf('terms-of-service')!;
const privacyVersion = currentVersionOf('privacy-policy')!;

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({});
  findMany.mockReset().mockResolvedValue([]);
});

describe('recordLegalAcceptance', () => {
  it('upserts one row per slug, keyed on (userId, documentSlug, version)', async () => {
    await recordLegalAcceptance('user-1', ['terms-of-service', 'privacy-policy'], {
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_documentSlug_version: {
            userId: 'user-1',
            documentSlug: 'terms-of-service',
            version: tosVersion,
          },
        },
        create: expect.objectContaining({
          userId: 'user-1',
          documentSlug: 'terms-of-service',
          version: tosVersion,
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

  it('excludes a slug accepted at its current version', async () => {
    findMany.mockResolvedValue([{ documentSlug: 'terms-of-service', version: tosVersion }]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual(['privacy-policy']);
  });

  it('treats an acceptance at a STALE version as still pending', async () => {
    findMany.mockResolvedValue([
      { documentSlug: 'terms-of-service', version: '2000-01-01' },
      { documentSlug: 'privacy-policy', version: privacyVersion },
    ]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual(['terms-of-service']);
  });

  it('returns an empty list once both are accepted at their current version', async () => {
    findMany.mockResolvedValue([
      { documentSlug: 'terms-of-service', version: tosVersion },
      { documentSlug: 'privacy-policy', version: privacyVersion },
    ]);
    await expect(getPendingAcceptanceSlugs('user-1')).resolves.toEqual([]);
  });
});
