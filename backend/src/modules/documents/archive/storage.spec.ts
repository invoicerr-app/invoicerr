import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  archiveRoot,
  artifactExists,
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
