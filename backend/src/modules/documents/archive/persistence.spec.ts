import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import prisma from '@/prisma/prisma.service';

import { DocumentArchiveKind } from '../../../../prisma/generated/prisma/client';
import { computeContentHash } from './hashing';
import {
  createAuthorityVerdictArchive,
  createDocumentArchive,
  findOwnedArchive,
  listDocumentArchives,
  verifyDocumentArchive,
} from './persistence';
import { CURRENT_RETENTION_CALC_VERSION } from './retention/calc-version';
import { RetentionCatalog } from './retention/registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    // Read by `resolveDocumentIssueDate` (persistence.ts) — not exercised by name in most tests below
    // (they use `origin: 'archivedAt'` synthetic rules precisely so this fixture never has to matter),
    // but still needs a callable mock or `createDocumentArchive` throws on the unconditional lookup.
    documentInstance: { findFirst: jest.fn().mockResolvedValue(null) },
    documentArchive: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const findCompany = prisma.company.findUnique as jest.Mock;
const findDocumentInstance = prisma.documentInstance.findFirst as jest.Mock;
const createArchive = prisma.documentArchive.create as jest.Mock;
const createManyArchives = prisma.documentArchive.createMany as jest.Mock;
const findManyArchives = prisma.documentArchive.findMany as jest.Mock;
const findFirstArchive = prisma.documentArchive.findFirst as jest.Mock;

// `origin: 'archivedAt'` deliberately, in every rule below — this suite tests PERSISTENCE wiring (hash
// storage, re-send behaviour, the no-country-file null case), not any one country's real legal origin
// (that discipline is `retention/compute-retention.spec.ts` and the real `data/fr.json`'s own job).
// Counting from `archivedAt` keeps this file's pre-existing "archivedAt + Ny" arithmetic meaningful
// without also having to mock a `data.issueDate` on `documentInstance` for every test below.
const FR_CATALOG = new RetentionCatalog([
  {
    countryCode: 'FR',
    rules: [
      { label: 'fiscale', years: 6, origin: 'archivedAt', legalRef: 'LPF art. L102 B' },
      { label: 'commerciale', years: 10, origin: 'archivedAt', legalRef: 'C. com. art. L123-22' },
    ],
  },
]);

describe('archive/persistence', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_ARCHIVE_DIR;

  beforeEach(() => {
    jest.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'documents-archive-persistence-test-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = originalEnv;
  });

  describe('createDocumentArchive', () => {
    it('persists to disk, then writes a DocumentArchive row with retention resolved for FR (max of both durations)', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-1', ...data }));

      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('PDF') }];
      const result = await createDocumentArchive(
        { companyId: 'company-1', documentId: 'doc-1', artifacts },
        FR_CATALOG,
      );

      expect(createArchive).toHaveBeenCalledTimes(1);
      const written = createArchive.mock.calls[0][0].data;
      expect(written.companyId).toBe('company-1');
      expect(written.documentId).toBe('doc-1');
      expect(written.contentHash).toBe(computeContentHash(artifacts));
      expect(written.artifacts).toEqual([
        expect.objectContaining({ role: 'pdf', mime: 'application/pdf', byteLength: 3 }),
      ]);
      expect(written.retentionBasis).toMatch(/10y/);
      expect(written.retentionBasis).toMatch(/6y/);
      // The discriminator — a finding from an audit: "archives already written keep too early a retention
      // date" — asked for: every NEW archive stamps the version of the
      // algorithm that computed it, so a future reader (`document-archive-section.tsx#
      // isRetentionCalcStale`) can tell it apart from a row written before this column existed.
      expect(written.retentionCalcVersion).toBe(CURRENT_RETENTION_CALC_VERSION);

      const expectedUntil = new Date(written.archivedAt);
      expectedUntil.setUTCFullYear(expectedUntil.getUTCFullYear() + 10);
      expect(written.retentionUntil.toISOString()).toBe(expectedUntil.toISOString());

      expect(result.id).toBe('archive-1');
    });

    it('reads the document’s own data.issueDate and threads it into computeRetention — never archivedAt', async () => {
      // A German-shaped rule (UStG § 14b Abs. 1: 8 years from the END of the calendar year of issue)
      // proves this end-to-end through persistence.ts, not just compute-retention.ts in isolation: an
      // invoice issued 2026-03-15, archived on a DIFFERENT day entirely, must resolve from
      // 2026-12-31 — never from whatever `archivedAt` happens to be.
      const DE_CATALOG = new RetentionCatalog([
        {
          countryCode: 'DE',
          rules: [
            {
              label: 'umsatzsteuerlich',
              years: 8,
              origin: 'issueDateYearEnd',
              legalRef: 'UStG § 14b Abs. 1',
            },
          ],
        },
      ]);
      findCompany.mockResolvedValue({ country: 'Germany', countryCode: 'DE' });
      findDocumentInstance.mockResolvedValue({ data: { issueDate: '2026-03-15' } });
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-de', ...data }));

      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('DE') }];
      await createDocumentArchive({ companyId: 'company-de', documentId: 'doc-de', artifacts }, DE_CATALOG);

      expect(findDocumentInstance).toHaveBeenCalledWith({
        where: { id: 'doc-de', companyId: 'company-de' },
        select: { data: true },
      });
      const written = createArchive.mock.calls[0][0].data;
      // 2026-12-31 (end of the ISSUE year) + 8 — not the archivedAt-based date the old defect produced.
      expect(written.retentionUntil.toISOString()).toBe('2034-12-31T00:00:00.000Z');
    });

    it('archives even a country with no declared retention rule — null retentionUntil, honest basis', async () => {
      findCompany.mockResolvedValue({ country: 'Nowhereland', countryCode: 'ZZ' });
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-2', ...data }));

      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('X') }];
      await createDocumentArchive({ companyId: 'company-2', documentId: 'doc-2', artifacts }, FR_CATALOG);

      const written = createArchive.mock.calls[0][0].data;
      expect(written.retentionUntil).toBeNull();
      expect(written.retentionBasis).toMatch(/no retention rule declared/i);
    });

    it('refuses to archive an empty artifact set — never a row claiming something was archived', async () => {
      await expect(
        createDocumentArchive({ companyId: 'c', documentId: 'd', artifacts: [] }, FR_CATALOG),
      ).rejects.toThrow(/no artifacts/i);
      expect(createArchive).not.toHaveBeenCalled();
    });

    it('a re-send of the same document produces a SECOND, independent archive row — never overwritten', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      createArchive
        .mockImplementationOnce(({ data }) => Promise.resolve({ id: 'archive-1', ...data }))
        .mockImplementationOnce(({ data }) => Promise.resolve({ id: 'archive-2', ...data }));

      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('v1') }];
      const first = await createDocumentArchive(
        { companyId: 'company-1', documentId: 'doc-1', artifacts },
        FR_CATALOG,
      );
      const second = await createDocumentArchive(
        { companyId: 'company-1', documentId: 'doc-1', artifacts },
        FR_CATALOG,
      );

      expect(createArchive).toHaveBeenCalledTimes(2);
      expect(first.id).not.toBe(second.id);
    });
  });

  // Legal archiving's own remainder (2026-09-06) — the
  // PROBATIVE archive for a TERMINAL authority verdict, under the same discipline as
  // `createDocumentArchive` above, but linked to and inheriting the retention of the DELIVERY archive
  // it attests to instead of resolving its own.
  describe('createAuthorityVerdictArchive', () => {
    const PARENT = {
      id: 'delivery-archive-1',
      companyId: 'company-1',
      documentId: 'doc-1',
      kind: DocumentArchiveKind.DELIVERY,
      parentArchiveId: null,
      contentHash: 'parent-content-hash',
      uri: 'file:///wherever',
      artifacts: [],
      archivedAt: new Date('2026-09-01T00:00:00Z'),
      retentionUntil: new Date('2036-09-01T00:00:00Z'),
      retentionBasis: 'commerciale 10y (C. com. art. L123-22).',
      retentionCalcVersion: CURRENT_RETENTION_CALC_VERSION,
    };

    const EVENT = {
      companyId: 'company-1',
      documentId: 'doc-1',
      providerId: 'pdp',
      statusCode: 'fr:202',
      statusText: 'Reçue par la plateforme',
      reason: null,
      observedAt: new Date('2026-09-06T10:00:00Z'),
      rawPayload: { events: [{ status_code: 'fr:202' }] },
    };

    it('links to the most recent DELIVERY archive and copies its retention VERBATIM — never recomputed', async () => {
      findFirstArchive.mockResolvedValue(PARENT);
      createManyArchives.mockResolvedValue({ count: 1 });

      const outcome = await createAuthorityVerdictArchive(EVENT);

      expect(outcome).toEqual({ archived: true });
      expect(findFirstArchive).toHaveBeenCalledWith({
        where: { companyId: 'company-1', documentId: 'doc-1', kind: DocumentArchiveKind.DELIVERY },
        orderBy: { archivedAt: 'desc' },
      });

      const written = createManyArchives.mock.calls[0][0].data[0];
      expect(written.kind).toBe(DocumentArchiveKind.VERDICT);
      expect(written.parentArchiveId).toBe(PARENT.id);
      expect(written.verdictKey).toBe('doc-1|pdp|fr:202');
      // The whole point of this decision (2026-09-06): SAME retentionUntil/Basis as the parent, not a
      // fresh one resolved for "now" — mutating either of these two lines must fail this test.
      expect(written.retentionUntil).toBe(PARENT.retentionUntil);
      expect(written.retentionBasis).toBe(PARENT.retentionBasis);
      // Same discipline for the discriminator: a verdict never gets its OWN "current" stamp just
      // because it was archived today — it inherits the DEPOSIT's own, so the UI's staleness notice
      // tracks the deposit, never the (irrelevant) freshness of the verdict poll itself.
      expect(written.retentionCalcVersion).toBe(PARENT.retentionCalcVersion);
      expect(written.artifacts).toEqual([
        expect.objectContaining({ role: 'authority-verdict', mime: 'application/json' }),
      ]);
      expect(createManyArchives).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    });

    it('a verdict on an OLD (pre-calc-version) deposit stays flagged too — null propagates, never upgraded', async () => {
      // A deposit archived before `retentionCalcVersion` existed at all (the exact shape a real
      // pre-migration row, or `persistence.spec.ts`'s own `toResult` default, produces) must not be
      // "repaired" into looking current just because a verdict happens to arrive on it today.
      findFirstArchive.mockResolvedValue({ ...PARENT, retentionCalcVersion: null });
      createManyArchives.mockResolvedValue({ count: 1 });

      await createAuthorityVerdictArchive(EVENT);

      const written = createManyArchives.mock.calls[0][0].data[0];
      expect(written.retentionCalcVersion).toBeNull();
    });

    it('embeds the parent’s own contentHash in the archived bytes — self-contained even without the database', async () => {
      findFirstArchive.mockResolvedValue(PARENT);
      createManyArchives.mockResolvedValue({ count: 1 });

      await createAuthorityVerdictArchive(EVENT);

      const written = createManyArchives.mock.calls[0][0].data[0];
      const filePath = join(written.uri.replace('file://', ''), 'authority-verdict.json');
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(parsed.deposit).toEqual({
        documentId: 'doc-1',
        archiveId: PARENT.id,
        contentHash: PARENT.contentHash,
      });
      expect(parsed.rawPayload).toEqual(EVENT.rawPayload);
    });

    it('never archives (never even hashes/writes) a verdict for a document with no deposit archive at all', async () => {
      findFirstArchive.mockResolvedValue(null);

      const outcome = await createAuthorityVerdictArchive(EVENT);

      expect(outcome).toEqual({ archived: false, reason: 'no-deposit-archive' });
      expect(createManyArchives).not.toHaveBeenCalled();
    });

    it('is idempotent — a re-poll of the same terminal status archives nothing a second time', async () => {
      findFirstArchive.mockResolvedValue(PARENT);
      createManyArchives.mockResolvedValue({ count: 0 }); // the unique verdictKey already exists

      const outcome = await createAuthorityVerdictArchive(EVENT);

      expect(outcome).toEqual({ archived: false, reason: 'duplicate' });
    });

    it('mutating the payload changes the archived contentHash — content-sensitive, not merely a label', async () => {
      findFirstArchive.mockResolvedValue(PARENT);
      createManyArchives.mockResolvedValue({ count: 1 });

      await createAuthorityVerdictArchive(EVENT);
      const firstHash = createManyArchives.mock.calls[0][0].data[0].contentHash;

      createManyArchives.mockClear();
      await createAuthorityVerdictArchive({
        ...EVENT,
        rawPayload: { events: [{ status_code: 'fr:202-mutated' }] },
      });
      const secondHash = createManyArchives.mock.calls[0][0].data[0].contentHash;

      expect(secondHash).not.toBe(firstHash);
    });
  });

  describe('listDocumentArchives / findOwnedArchive', () => {
    it('lists rows scoped by companyId+documentId, most recent first (delegated to the ORDER BY)', async () => {
      findManyArchives.mockResolvedValue([
        {
          id: 'a2',
          companyId: 'c',
          documentId: 'd',
          contentHash: 'h2',
          uri: 'file:///x',
          artifacts: [],
          archivedAt: new Date(),
          retentionUntil: null,
          retentionBasis: null,
        },
      ]);
      const rows = await listDocumentArchives('c', 'd');
      expect(findManyArchives).toHaveBeenCalledWith({
        where: { companyId: 'c', documentId: 'd' },
        orderBy: { archivedAt: 'desc' },
      });
      expect(rows).toHaveLength(1);
    });

    it('findOwnedArchive 404s for an archive that does not belong to this company/document', async () => {
      findFirstArchive.mockResolvedValue(null);
      await expect(findOwnedArchive('c', 'd', 'missing')).rejects.toThrow(/not found/i);
    });

    it('a row from before retentionCalcVersion existed surfaces as null — never defaulted to "current"', async () => {
      // No `retentionCalcVersion` key at all — exactly the shape a row written before the migration
      // that added this column has (see `schema.prisma`'s own comment: no `@default`, so Prisma
      // itself returns `null` for it once the column exists; this fixture instead models a caller
      // that never even selected the column, the same defensive case `kind`'s own `?? DELIVERY`
      // fallback above already covers).
      findFirstArchive.mockResolvedValue({
        id: 'archive-old',
        companyId: 'c',
        documentId: 'd',
        contentHash: 'h1',
        uri: 'file:///x',
        artifacts: [],
        archivedAt: new Date(),
        retentionUntil: new Date('2030-01-01T00:00:00Z'),
        retentionBasis: 'unique 5y (Some Act §1).',
      });
      const archive = await findOwnedArchive('c', 'd', 'archive-old');
      expect(archive.retentionCalcVersion).toBeNull();
    });

    it('a row that DOES carry retentionCalcVersion surfaces it verbatim — never dropped', async () => {
      findFirstArchive.mockResolvedValue({
        id: 'archive-new',
        companyId: 'c',
        documentId: 'd',
        contentHash: 'h1',
        uri: 'file:///x',
        artifacts: [],
        archivedAt: new Date(),
        retentionUntil: new Date('2030-01-01T00:00:00Z'),
        retentionBasis: 'unique 5y (Some Act §1).',
        retentionCalcVersion: CURRENT_RETENTION_CALC_VERSION,
      });
      const archive = await findOwnedArchive('c', 'd', 'archive-new');
      expect(archive.retentionCalcVersion).toBe(CURRENT_RETENTION_CALC_VERSION);
    });
  });

  describe('verifyDocumentArchive', () => {
    async function archiveOneRealPdf(bytes: string) {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-1', ...data }));
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode(bytes) }];
      const created = await createDocumentArchive(
        { companyId: 'company-1', documentId: 'doc-1', artifacts },
        FR_CATALOG,
      );
      findFirstArchive.mockResolvedValue({ ...created });
      return created;
    }

    it('reports "intact" when the stored bytes still match the recorded hash', async () => {
      await archiveOneRealPdf('%PDF-1.7 real bytes');
      const result = await verifyDocumentArchive('company-1', 'doc-1', 'archive-1');
      expect(result.status).toBe('intact');
    });

    it('reports "corrupted", NAMING the artifact and its expected/actual hash, when a byte on disk is altered', async () => {
      const created = await archiveOneRealPdf('%PDF-1.7 real bytes');
      // Corrupt the stored file directly — a byte rewritten on disk in the test, never an in-memory
      // simulation.
      const filePath = join(created.uri.replace('file://', ''), 'pdf.pdf');
      writeFileSync(filePath, 'TAMPERED-BYTES-DIFFERENT-LENGTH');

      const result = await verifyDocumentArchive('company-1', 'doc-1', 'archive-1');

      expect(result.status).toBe('corrupted');
      if (result.status === 'corrupted') {
        expect(result.details).toEqual([
          expect.objectContaining({ role: 'pdf', expected: created.artifacts[0].sha256 }),
        ]);
        expect(result.details[0].actual).not.toBe(result.details[0].expected);
        expect(result.details[0].actual).not.toBeNull();
      }
    });

    it('reports "corrupted" when a stored artifact file is missing entirely', async () => {
      const created = await archiveOneRealPdf('%PDF-1.7 real bytes');
      rmSync(join(created.uri.replace('file://', ''), 'pdf.pdf'));

      const result = await verifyDocumentArchive('company-1', 'doc-1', 'archive-1');

      expect(result.status).toBe('corrupted');
      if (result.status === 'corrupted') {
        expect(result.details).toEqual([expect.objectContaining({ role: 'pdf', actual: null })]);
      }
    });
  });
});
