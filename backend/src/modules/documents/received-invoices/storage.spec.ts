import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extFor, inboundRoot, persistInboundFile, readInboundFile } from './storage';

describe('received-invoices/storage — local, content-hash-addressed, company-scoped persistence', () => {
  // JAMAIS le cwd du projet — un répertoire de test réel sous os.tmpdir(), comme archive/storage.spec.ts.
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-inbound-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
  });

  it('inboundRoot() is re-read on every call — reflects the env var live, never cached', () => {
    expect(inboundRoot()).toBe(dir);
    const other = mkdtempSync(join(tmpdir(), 'documents-inbound-test-2-'));
    process.env.DOCUMENTS_INBOUND_DIR = other;
    expect(inboundRoot()).toBe(other);
    rmSync(other, { recursive: true, force: true });
  });

  it('extFor maps known mimes and falls back to .bin for an unrecognized one', () => {
    expect(extFor('application/pdf')).toBe('pdf');
    expect(extFor('application/xml')).toBe('xml');
    expect(extFor('application/octet-stream')).toBe('bin');
  });

  it('persists under <root>/<companyId>/<sha256>.<ext>', () => {
    const uri = persistInboundFile(
      'company-1',
      'abc123',
      'application/pdf',
      new TextEncoder().encode('%PDF-fake'),
    );
    expect(uri).toBe(`file://${join(dir, 'company-1', 'abc123.pdf')}`);
    expect(existsSync(join(dir, 'company-1', 'abc123.pdf'))).toBe(true);
    expect(readFileSync(join(dir, 'company-1', 'abc123.pdf'), 'utf-8')).toBe('%PDF-fake');
  });

  it('two DIFFERENT companies never share a path, even for the same hash', () => {
    persistInboundFile('company-1', 'same-hash', 'application/xml', new TextEncoder().encode('company one'));
    persistInboundFile('company-2', 'same-hash', 'application/xml', new TextEncoder().encode('company two'));

    expect(readInboundFile('company-1', 'same-hash', 'application/xml')?.toString('utf-8')).toBe(
      'company one',
    );
    expect(readInboundFile('company-2', 'same-hash', 'application/xml')?.toString('utf-8')).toBe(
      'company two',
    );
  });

  it('re-persisting the SAME hash for the SAME company overwrites idempotently', () => {
    persistInboundFile('company-1', 'hash-1', 'application/xml', new TextEncoder().encode('first'));
    persistInboundFile('company-1', 'hash-1', 'application/xml', new TextEncoder().encode('first')); // byte-identical
    expect(readInboundFile('company-1', 'hash-1', 'application/xml')?.toString('utf-8')).toBe('first');
  });

  it('readInboundFile returns null (never throws) for a missing file', () => {
    expect(readInboundFile('company-1', 'never-uploaded', 'application/pdf')).toBeNull();
  });
});
