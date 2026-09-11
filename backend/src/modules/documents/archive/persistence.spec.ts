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
import { RetentionCatalog } from './retention/registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    documentArchive: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const findCompany = prisma.company.findUnique as jest.Mock;
const createArchive = prisma.documentArchive.create as jest.Mock;
const createManyArchives = prisma.documentArchive.createMany as jest.Mock;
const findManyArchives = prisma.documentArchive.findMany as jest.Mock;
const findFirstArchive = prisma.documentArchive.findFirst as jest.Mock;

const FR_CATALOG = new RetentionCatalog([
  {
    countryCode: 'FR',
    rules: [
      { label: 'fiscale', years: 6, legalRef: 'LPF art. L102 B' },
      { label: 'commerciale', years: 10, legalRef: 'C. com. art. L123-22' },
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

      const expectedUntil = new Date(written.archivedAt);
      expectedUntil.setUTCFullYear(expectedUntil.getUTCFullYear() + 10);
      expect(written.retentionUntil.toISOString()).toBe(expectedUntil.toISOString());

      expect(result.id).toBe('archive-1');
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
      expect(written.artifacts).toEqual([
        expect.objectContaining({ role: 'authority-verdict', mime: 'application/json' }),
      ]);
      expect(createManyArchives).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
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
      // On corrompt directement le fichier stocké — un octet réécrit dans le fichier du test, comme
      // demandé par la tâche, jamais une simulation en mémoire.
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
