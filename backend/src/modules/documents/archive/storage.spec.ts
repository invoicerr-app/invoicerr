import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { archiveRoot, extFor, persistArtifacts, readArchivedArtifact } from './storage';

describe('archive/storage — local, content-hash-addressed persistence', () => {
  // JAMAIS le cwd du projet — un répertoire de test réel sous os.tmpdir(), comme le repère.
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_ARCHIVE_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-archive-test-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = originalEnv;
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
    expect(extFor('application/octet-stream')).toBe('bin');
  });

  it('persists every artifact under <root>/<documentId>/<contentHash>/<role>.<ext>', () => {
    const artifacts = [
      { role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-fake') },
      { role: 'facturx', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-facturx') },
    ];
    const { uri, contentHash } = persistArtifacts('doc-1', artifacts);

    expect(uri).toBe(`file://${join(dir, 'doc-1', contentHash)}`);
    expect(existsSync(join(dir, 'doc-1', contentHash, 'pdf.pdf'))).toBe(true);
    expect(existsSync(join(dir, 'doc-1', contentHash, 'facturx.pdf'))).toBe(true);
    expect(readFileSync(join(dir, 'doc-1', contentHash, 'pdf.pdf'), 'utf-8')).toBe('%PDF-fake');
  });

  it('re-archiving byte-identical artifacts for the SAME document is idempotent — same path', () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('same') }];
    const first = persistArtifacts('doc-1', artifacts);
    const second = persistArtifacts('doc-1', artifacts);
    expect(second.uri).toBe(first.uri);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('readArchivedArtifact reads back exactly what was written', () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('bytes!') }];
    const { uri } = persistArtifacts('doc-1', artifacts);
    const read = readArchivedArtifact(uri, 'pdf', 'application/pdf');
    expect(read?.toString('utf-8')).toBe('bytes!');
  });

  it('readArchivedArtifact returns null (never throws) for a missing artifact', () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = persistArtifacts('doc-1', artifacts);
    expect(readArchivedArtifact(uri, 'facturx', 'application/pdf')).toBeNull();
  });
});
