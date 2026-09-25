import { vi, type Mock } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import prisma from '@/prisma/prisma.service';

import { DocumentArchiveKind } from '../../../../prisma/generated/prisma/client';
import { computeContentHash } from './hashing';
import {
  createAuthorityVerdictArchive,
  createDocumentArchive,
  createManualAcceptanceArchive,
  findArchivedPdfArtifact,
  findManualAcceptanceArchive,
  findOwnedArchive,
  listDocumentArchives,
  verifyDocumentArchive,
} from './persistence';
import { CURRENT_RETENTION_CALC_VERSION } from './retention/calc-version';
import { RetentionCatalog } from './retention/registry';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    // Read by `resolveDocumentIssueDate` (persistence.ts) — not exercised by name in most tests below
    // (they use `origin: 'archivedAt'` synthetic rules precisely so this fixture never has to matter),
    // but still needs a callable mock or `createDocumentArchive` throws on the unconditional lookup.
    documentInstance: { findFirst: vi.fn().mockResolvedValue(null) },
    documentArchive: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

const findCompany = prisma.company.findUnique as Mock;
const findDocumentInstance = prisma.documentInstance.findFirst as Mock;
const createArchive = prisma.documentArchive.create as Mock;
const createManyArchives = prisma.documentArchive.createMany as Mock;
const findManyArchives = prisma.documentArchive.findMany as Mock;
const findFirstArchive = prisma.documentArchive.findFirst as Mock;

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
    vi.clearAllMocks();
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
      // 2026-12-31 23:59:59.999 (the LAST instant of the ISSUE year — "mit dem Schluss des
      // Kalenderjahres", see compute-retention.ts#endOfYearUtc's own header) + 8 — not the
      // archivedAt-based date the old defect produced, and not the year's first midnight either.
      expect(written.retentionUntil.toISOString()).toBe('2034-12-31T23:59:59.999Z');
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

  // Serves `documents.service.ts#renderInstancePdf` — the read half of "an already-sent document's
  // PDF download skips Chromium entirely". Deliberately exercises the REAL `createDocumentArchive` ->
  // real disk write -> `findArchivedPdfArtifact` -> real disk read round trip (only `documentArchive`
  // itself is mocked, standing in for the row a real "send" would have committed) — a mocked
  // `readArchivedArtifact` would prove the wiring but nothing about the bytes actually surviving a
  // real write/read cycle unchanged, which is the one property that matters here.
  describe('findArchivedPdfArtifact', () => {
    it('reads back, byte-for-byte off real disk, the "pdf" artifact a send-time archive wrote', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-1', ...data }));

      const pdfBytes = new TextEncoder().encode('%PDF-1.7 exactly what was emailed');
      const written = await createDocumentArchive(
        {
          companyId: 'company-1',
          documentId: 'doc-1',
          artifacts: [{ role: 'pdf', mime: 'application/pdf', bytes: pdfBytes }],
        },
        FR_CATALOG,
      );
      // What a real `documentArchive.findFirst` (kind DELIVERY, most recent) would hand back — the
      // SAME row `createDocumentArchive` just wrote, `uri` included, pointing at the real bytes on
      // disk under this test's own temp `DOCUMENTS_ARCHIVE_DIR`.
      findFirstArchive.mockResolvedValue({
        id: 'archive-1',
        companyId: 'company-1',
        documentId: 'doc-1',
        uri: written.uri,
        artifacts: written.artifacts,
      });

      const served = await findArchivedPdfArtifact('company-1', 'doc-1');

      expect(served).not.toBeNull();
      expect(Buffer.from(served!)).toEqual(Buffer.from(pdfBytes));
    });

    it('returns null when the archive exists but carries no plain-PDF artifact (pdp/chorus-pro\'s own "facturx" role, ksef\'s "fa3", sdi\'s "fatturapa")', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-1', ...data }));

      // A Factur-X file's OWN mime is also `application/pdf` (a real, renderable PDF/A-3) — this
      // proves the match is on `role: 'pdf'`, never mime alone (see this function's own header for
      // why: that artifact was never PAdES-signed the way "email"'s own archived PDF was).
      const written = await createDocumentArchive(
        {
          companyId: 'company-1',
          documentId: 'doc-1',
          artifacts: [
            { role: 'facturx', mime: 'application/pdf', bytes: new TextEncoder().encode('hybrid pdf/a-3') },
          ],
        },
        FR_CATALOG,
      );
      findFirstArchive.mockResolvedValue({
        id: 'archive-1',
        companyId: 'company-1',
        documentId: 'doc-1',
        uri: written.uri,
        artifacts: written.artifacts,
      });

      await expect(findArchivedPdfArtifact('company-1', 'doc-1')).resolves.toBeNull();
    });

    it('returns null when this document has no DELIVERY archive at all (a draft, or an archiving failure)', async () => {
      findFirstArchive.mockResolvedValue(null);

      await expect(findArchivedPdfArtifact('company-1', 'doc-1')).resolves.toBeNull();
    });
  });

  // Issue #421: "accept a quote manually, without the e-signature code" - the LEGAL-ARCHIVE half of
  // that feature (`actions/quote-manual-acceptance.ts`'s own header). Exercises the REAL
  // createManualAcceptanceArchive -> real disk write -> real disk read round trip through
  // findManualAcceptanceArchive, the exact same discipline `findArchivedPdfArtifact`'s own tests just
  // above hold - the property that matters is that the note/actor/method text SURVIVES a real
  // write/read cycle, byte for byte, not merely that the wiring compiles.
  describe('createManualAcceptanceArchive / findManualAcceptanceArchive', () => {
    const manifestBytes = (overrides: Partial<Record<string, unknown>> = {}) =>
      Buffer.from(
        JSON.stringify({
          kind: 'manual-acceptance',
          documentId: 'doc-1',
          actorId: 'user-1',
          actorName: 'Jane Doe',
          actorEmail: 'jane@example.com',
          note: 'Accepted by phone on 2026-09-20, client confirmed the total.',
          acceptedAt: '2026-09-20T10:00:00.000Z',
          ...overrides,
        }),
      );

    it('archives under its OWN kind (ACCEPTANCE), never DELIVERY or VERDICT, and reads the exact manifest back', async () => {
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-acc-1', ...data }));
      findFirstArchive.mockResolvedValueOnce(null); // no DELIVERY parent for this document
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });

      const written = await createManualAcceptanceArchive({
        companyId: 'company-1',
        documentId: 'doc-1',
        manifest: manifestBytes(),
      });

      expect(written.kind).toBe(DocumentArchiveKind.ACCEPTANCE);
      const createCall = createArchive.mock.calls[0][0].data;
      expect(createCall.kind).toBe(DocumentArchiveKind.ACCEPTANCE);
      expect(createCall.parentArchiveId).toBeNull();
      expect(createCall.artifacts).toEqual([
        expect.objectContaining({ role: 'manual-acceptance', mime: 'application/json' }),
      ]);

      // Read back through the SAME `documentArchive.findFirst` a real query (kind: ACCEPTANCE) would
      // return - proves the READ side filters by kind too, never picking up a DELIVERY/VERDICT row.
      findFirstArchive.mockResolvedValueOnce({
        id: 'archive-acc-1',
        companyId: 'company-1',
        documentId: 'doc-1',
        uri: written.uri,
      });

      const manifest = await findManualAcceptanceArchive('company-1', 'doc-1');
      expect(manifest).not.toBeNull();
      expect(manifest).toMatchObject({
        kind: 'manual-acceptance',
        actorName: 'Jane Doe',
        actorEmail: 'jane@example.com',
        note: expect.stringContaining('phone'),
      });
      // THE DISTINCTION, proven directly against the actual bytes read off disk: no key anywhere in
      // this manifest names an e-signature concept (an OTP, a signature token, "signedAt"...) - a
      // manual acceptance carries none of that evidence, on purpose (actions/quote-manual-acceptance.ts's
      // own header).
      const keys = Object.keys(manifest!);
      expect(keys.some((k) => /sign|otp/i.test(k))).toBe(false);
      expect(JSON.stringify(manifest)).not.toMatch(/otp|signature/i);
    });

    it('links to, and copies retention from, the most recent DELIVERY archive when one exists', async () => {
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-acc-2', ...data }));
      findFirstArchive.mockResolvedValueOnce({
        id: 'delivery-1',
        retentionUntil: new Date('2036-01-01T00:00:00Z'),
        retentionBasis: 'fiscale 6y (LPF art. L102 B).',
        retentionCalcVersion: CURRENT_RETENTION_CALC_VERSION,
      });

      await createManualAcceptanceArchive({
        companyId: 'company-1',
        documentId: 'doc-1',
        manifest: manifestBytes(),
      });

      const createCall = createArchive.mock.calls[0][0].data;
      expect(createCall.parentArchiveId).toBe('delivery-1');
      expect(createCall.retentionUntil).toEqual(new Date('2036-01-01T00:00:00Z'));
      expect(createCall.retentionBasis).toBe('fiscale 6y (LPF art. L102 B).');
    });

    it('never blocks on a missing DELIVERY parent - resolves its own retention instead of refusing', async () => {
      createArchive.mockImplementation(({ data }) => Promise.resolve({ id: 'archive-acc-3', ...data }));
      findFirstArchive.mockResolvedValueOnce(null);
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });

      const result = await createManualAcceptanceArchive({
        companyId: 'company-1',
        documentId: 'doc-1',
        manifest: manifestBytes(),
      });

      expect(result.kind).toBe(DocumentArchiveKind.ACCEPTANCE);
      const createCall = createArchive.mock.calls[0][0].data;
      expect(createCall.parentArchiveId).toBeNull();
      // Resolved fresh against FR_CATALOG's default catalog resolution (defaultRetentionCatalog is the
      // real, shipped catalog here - not FR_CATALOG's own test fixture) - just proving it is NOT null
      // and not thrown is the point; the exact figure belongs to compute-retention.spec.ts's own tests.
      expect(createCall.retentionCalcVersion).toBe(CURRENT_RETENTION_CALC_VERSION);
    });

    it('returns null for a document that was never manually accepted', async () => {
      findFirstArchive.mockResolvedValueOnce(null);
      await expect(findManualAcceptanceArchive('company-1', 'doc-1')).resolves.toBeNull();
    });
  });

  // Legal archiving's own remainder (2026-09-06) - the
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
