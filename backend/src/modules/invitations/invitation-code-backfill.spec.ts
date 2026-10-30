import { hashInvitationCode } from '@/lib/invitation-code';

import { digestLegacyInvitationCodes, type InvitationCodeBackfillPrisma } from './invitation-code-backfill';

interface Row {
  id: string;
  code: string | null;
  codeHash: string | null;
  codePrefix: string | null;
}

/** In-memory stand-in honouring only the two calls the backfill makes, including the `code IS NOT
 *  NULL` guard that makes concurrent boots safe. */
function fakePrisma(rows: Row[], options: { loseRaceOn?: string[] } = {}) {
  const findMany = vi.fn(
    async ({ take }: { take: number }) =>
      rows.filter((row) => row.code !== null).slice(0, take).map(({ id, code }) => ({ id, code: code! })),
  );

  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; code: { not: null } };
      data: { code: null; codeHash: string; codePrefix: string };
    }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row || row.code === null || options.loseRaceOn?.includes(where.id)) return { count: 0 };
      row.code = data.code;
      row.codeHash = data.codeHash;
      row.codePrefix = data.codePrefix;
      return { count: 1 };
    },
  );

  return { prisma: { invitationCode: { findMany, updateMany } } as InvitationCodeBackfillPrisma, findMany };
}

const CODE_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CODE_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('digestLegacyInvitationCodes', () => {
  it('replaces every plaintext code with its digest and preview', async () => {
    const rows: Row[] = [
      { id: 'a', code: CODE_A, codeHash: null, codePrefix: null },
      { id: 'b', code: CODE_B, codeHash: null, codePrefix: null },
    ];
    const { prisma } = fakePrisma(rows);

    const summary = await digestLegacyInvitationCodes(prisma);

    expect(summary).toEqual({ scanned: 2, migrated: 2 });
    expect(rows[0]).toEqual({
      id: 'a',
      code: null,
      codeHash: hashInvitationCode(CODE_A),
      codePrefix: CODE_A.slice(0, 8),
    });
    expect(rows[1].code).toBeNull();
  });

  it('is idempotent: a second pass finds nothing left and writes nothing', async () => {
    const rows: Row[] = [{ id: 'a', code: CODE_A, codeHash: null, codePrefix: null }];
    const { prisma, findMany } = fakePrisma(rows);

    expect(await digestLegacyInvitationCodes(prisma)).toEqual({ scanned: 1, migrated: 1 });
    findMany.mockClear();
    expect(await digestLegacyInvitationCodes(prisma)).toEqual({ scanned: 0, migrated: 0 });
    expect(findMany).toHaveBeenCalledTimes(1); // one empty read, no writes
  });

  it('counts a row another replica won as scanned but not migrated, and stops rather than spinning', async () => {
    const rows: Row[] = [{ id: 'a', code: CODE_A, codeHash: null, codePrefix: null }];
    const { prisma } = fakePrisma(rows, { loseRaceOn: ['a'] });

    expect(await digestLegacyInvitationCodes(prisma)).toEqual({ scanned: 1, migrated: 0 });
  });

  it('leaves an already-digested row untouched', async () => {
    const rows: Row[] = [
      { id: 'a', code: null, codeHash: hashInvitationCode(CODE_A), codePrefix: CODE_A.slice(0, 8) },
    ];
    const { prisma } = fakePrisma(rows);

    expect(await digestLegacyInvitationCodes(prisma)).toEqual({ scanned: 0, migrated: 0 });
  });

  it('treats an empty legacy string as nothing to digest instead of hashing it', async () => {
    const rows: Row[] = [{ id: 'a', code: '', codeHash: null, codePrefix: null }];
    const { prisma, findMany } = fakePrisma(rows);

    expect(await digestLegacyInvitationCodes(prisma)).toEqual({ scanned: 0, migrated: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(rows[0].codeHash).toBeNull();
  });
});
