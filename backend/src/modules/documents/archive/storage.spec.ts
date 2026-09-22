import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  archiveRoot,
  artifactExists,
  checkArchiveStorageSharing,
  deleteArchivedArtifacts,
  extFor,
  listArchivedArtifactKeys,
  persistArtifacts,
  readArchivedArtifact,
} from './storage';

describe('archive/storage — local, content-hash-addressed persistence', () => {
  // NEVER the project's cwd — a real test directory under os.tmpdir(), the same as the removed
  // compliance engine.
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_ARCHIVE_DIR;
  const originalArchiveStorage = process.env.ARCHIVE_STORAGE;
  const originalArchiveS3Bucket = process.env.ARCHIVE_S3_BUCKET;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-archive-test-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = dir;
    // Every test in this file exercises LOCAL mode specifically — see s3-storage.spec.ts for the S3
    // dispatch path. Cleared explicitly rather than assumed unset: a prior file in the same jest
    // worker (s3-storage.live.spec.ts included) could otherwise leak these across files.
    delete process.env.ARCHIVE_STORAGE;
    delete process.env.ARCHIVE_S3_BUCKET;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = originalEnv;
    if (originalArchiveStorage === undefined) delete process.env.ARCHIVE_STORAGE;
    else process.env.ARCHIVE_STORAGE = originalArchiveStorage;
    if (originalArchiveS3Bucket === undefined) delete process.env.ARCHIVE_S3_BUCKET;
    else process.env.ARCHIVE_S3_BUCKET = originalArchiveS3Bucket;
  });

  it('archiveRoot() is re-read on every call — reflects the env var live, never cached', () => {
    expect(archiveRoot()).toBe(dir);
    const other = mkdtempSync(join(tmpdir(), 'documents-archive-test-2-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = other;
    expect(archiveRoot()).toBe(other);
    rmSync(other, { recursive: true, force: true });
  });

  it('extFor maps known mimes to extensions and falls back to .bin', () => {
    expect(extFor('application/pdf')).toBe('pdf');
    expect(extFor('application/xml')).toBe('xml');
    expect(extFor('application/json')).toBe('json');
    expect(extFor('application/octet-stream')).toBe('bin');
  });

  it('persists every artifact under <root>/<documentId>/<contentHash>/<role>.<ext>', async () => {
    const artifacts = [
      { role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-fake') },
      { role: 'facturx', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-facturx') },
    ];
    const { uri, contentHash } = await persistArtifacts('doc-1', artifacts);

    expect(uri).toBe(`file://${join(dir, 'doc-1', contentHash)}`);
    expect(existsSync(join(dir, 'doc-1', contentHash, 'pdf.pdf'))).toBe(true);
    expect(existsSync(join(dir, 'doc-1', contentHash, 'facturx.pdf'))).toBe(true);
    expect(readFileSync(join(dir, 'doc-1', contentHash, 'pdf.pdf'), 'utf-8')).toBe('%PDF-fake');
  });

  it('re-archiving byte-identical artifacts for the SAME document is idempotent — same path', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('same') }];
    const first = await persistArtifacts('doc-1', artifacts);
    const second = await persistArtifacts('doc-1', artifacts);
    expect(second.uri).toBe(first.uri);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('readArchivedArtifact reads back exactly what was written', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('bytes!') }];
    const { uri } = await persistArtifacts('doc-1', artifacts);
    const read = await readArchivedArtifact(uri, 'pdf', 'application/pdf');
    expect(read?.toString('utf-8')).toBe('bytes!');
  });

  it('readArchivedArtifact returns null (never throws) for a missing artifact', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = await persistArtifacts('doc-1', artifacts);
    expect(await readArchivedArtifact(uri, 'facturx', 'application/pdf')).toBeNull();
  });

  it('artifactExists is true for a written artifact and false for one never written', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = await persistArtifacts('doc-1', artifacts);
    expect(await artifactExists(uri, 'pdf', 'application/pdf')).toBe(true);
    expect(await artifactExists(uri, 'facturx', 'application/pdf')).toBe(false);
  });

  it('deleteArchivedArtifacts removes the whole archive directory', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = await persistArtifacts('doc-1', artifacts);
    expect(await artifactExists(uri, 'pdf', 'application/pdf')).toBe(true);

    await deleteArchivedArtifacts(uri);

    expect(await artifactExists(uri, 'pdf', 'application/pdf')).toBe(false);
    expect(await readArchivedArtifact(uri, 'pdf', 'application/pdf')).toBeNull();
  });

  it('listArchivedArtifactKeys enumerates every file under the local root, and [] for an empty store', async () => {
    expect(await listArchivedArtifactKeys()).toEqual([]);

    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = await persistArtifacts('doc-1', artifacts);

    const keys = await listArchivedArtifactKeys();
    expect(keys).toEqual([`${uri}/pdf.pdf`]);
  });
});

/**
 * THE MUTATION TARGET: a split API/worker deployment (`WORKER_INLINE=false`,
 * docker-compose.scale.yml) with `ARCHIVE_STORAGE=local` (the default) needs `DOCUMENTS_ARCHIVE_DIR`
 * to be the SAME mounted volume in every container — if it is not, `verifyDocumentArchive` silently
 * reports every archive `{status:'corrupted', actual:null}` from the role that did not write it, and
 * nothing in the code used to detect the misconfiguration. These tests prove the detector itself: a
 * genuinely shared root reads back its own and another role's witness; a root that is NOT actually
 * shared (modeled here as a witness file this role cannot read) is refused, named.
 */
describe('archive/storage — checkArchiveStorageSharing (the multi-replica witness check)', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_ARCHIVE_DIR;
  const originalArchiveStorage = process.env.ARCHIVE_STORAGE;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-archive-witness-test-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = dir;
    delete process.env.ARCHIVE_STORAGE;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = originalEnv;
    if (originalArchiveStorage === undefined) delete process.env.ARCHIVE_STORAGE;
    else process.env.ARCHIVE_STORAGE = originalArchiveStorage;
  });

  it('ARCHIVE_STORAGE=s3 short-circuits to shared:true without touching the filesystem at all', () => {
    process.env.ARCHIVE_STORAGE = 's3';
    rmSync(dir, { recursive: true, force: true }); // prove nothing local is even created

    const result = checkArchiveStorageSharing('api');

    expect(result).toEqual({
      shared: true,
      reason: expect.stringMatching(/ARCHIVE_STORAGE=s3/),
    });
    expect(existsSync(dir)).toBe(false);
  });

  it('the FIRST role to boot: no other witness exists yet — inconclusive, but reported as shared (never a false failure on ordinary startup order)', () => {
    const result = checkArchiveStorageSharing('api');

    expect(result.shared).toBe(true);
    expect(result.reason).toMatch(/no other role has written its own witness/i);
    expect(existsSync(join(dir, '.archive-storage-witness-api.json'))).toBe(true);
  });

  it("a SECOND role, on a genuinely shared root: reads the first role's witness back and confirms it", () => {
    checkArchiveStorageSharing('api'); // the API role boots first, writes its own witness

    const result = checkArchiveStorageSharing('worker');

    expect(result).toEqual({ shared: true, reason: expect.stringMatching(/confirmed readable/i) });
    // Both witnesses now sit side by side — proves this role wrote its OWN, distinct from the first's.
    expect(existsSync(join(dir, '.archive-storage-witness-api.json'))).toBe(true);
    expect(existsSync(join(dir, '.archive-storage-witness-worker.json'))).toBe(true);
  });

  it('a witness that EXISTS but cannot be READ (permission denied) is refused, named — the exact "not truly shared" case this exists to catch', () => {
    const apiWitness = join(dir, '.archive-storage-witness-api.json');
    writeFileSync(apiWitness, JSON.stringify({ role: 'api' }));
    chmodSync(apiWitness, 0o000); // simulate two containers seeing the SAME path but not the same bytes

    try {
      const result = checkArchiveStorageSharing('worker');

      expect(result.shared).toBe(false);
      expect(result.reason).toMatch(/cannot read it back/);
    } finally {
      chmodSync(apiWitness, 0o644); // restore, so afterEach's rmSync can clean up
    }
  });

  it('a non-writable root is refused, named, rather than silently reporting shared:true', () => {
    chmodSync(dir, 0o500); // read+execute only — no write

    try {
      const result = checkArchiveStorageSharing('api');

      expect(result.shared).toBe(false);
      expect(result.reason).toMatch(/not writable/);
    } finally {
      chmodSync(dir, 0o700); // restore, so afterEach's rmSync can clean up
    }
  });
});
