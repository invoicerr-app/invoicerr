import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extFor, inboundRoot, persistInboundFile, readInboundFile } from './storage';

// Real-shaped SHA-256 digests (64 lowercase hex characters, what `computeArtifactHash` actually
// produces) rather than the short placeholder strings this file used before the hex-format check
// existed — those would now be rejected as malformed content hashes.
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

describe('received-invoices/storage — local, content-hash-addressed, company-scoped persistence', () => {
  // NEVER the project's cwd — a real test directory under os.tmpdir(), like archive/storage.spec.ts.
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

  // Enriched expense attachments ("notes de frais enrichies") — attachments.service.ts's own first
  // caller of this map with a PHOTO rather than a supplier document.
  it('extFor maps the three image mimes attachments.service.ts uploads', () => {
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/png')).toBe('png');
    expect(extFor('image/webp')).toBe('webp');
  });

  it('persists under <root>/<companyId>/<sha256>.<ext>', () => {
    const uri = persistInboundFile(
      'company-1',
      HASH_A,
      'application/pdf',
      new TextEncoder().encode('%PDF-fake'),
    );
    expect(uri).toBe(`file://${join(dir, 'company-1', `${HASH_A}.pdf`)}`);
    expect(existsSync(join(dir, 'company-1', `${HASH_A}.pdf`))).toBe(true);
    expect(readFileSync(join(dir, 'company-1', `${HASH_A}.pdf`), 'utf-8')).toBe('%PDF-fake');
  });

  it('two DIFFERENT companies never share a path, even for the same hash', () => {
    persistInboundFile('company-1', HASH_B, 'application/xml', new TextEncoder().encode('company one'));
    persistInboundFile('company-2', HASH_B, 'application/xml', new TextEncoder().encode('company two'));

    expect(readInboundFile('company-1', HASH_B, 'application/xml')?.toString('utf-8')).toBe('company one');
    expect(readInboundFile('company-2', HASH_B, 'application/xml')?.toString('utf-8')).toBe('company two');
  });

  it('re-persisting the SAME hash for the SAME company overwrites idempotently', () => {
    persistInboundFile('company-1', HASH_C, 'application/xml', new TextEncoder().encode('first'));
    persistInboundFile('company-1', HASH_C, 'application/xml', new TextEncoder().encode('first')); // byte-identical
    expect(readInboundFile('company-1', HASH_C, 'application/xml')?.toString('utf-8')).toBe('first');
  });

  it('readInboundFile returns null (never throws) for a missing file', () => {
    expect(readInboundFile('company-1', HASH_D, 'application/pdf')).toBeNull();
  });

  // `sha256` reaches this module straight off an HTTP route param on more than one caller
  // (documents.controller.ts's `:fileRef`) — never validated there. These are the regression cases
  // for what happens when it is NOT the 64-hex-character digest this module's own callers always
  // compute: a traversal-shaped value must never escape the company's own directory, whether or not
  // a real file happens to sit where it points.
  describe('a "sha256" that is not a genuine content hash', () => {
    it("readInboundFile returns null for a path-traversal-shaped value, even one that resolves to a REAL file in another company's own directory", () => {
      persistInboundFile(
        'victim-company',
        HASH_A,
        'application/pdf',
        new TextEncoder().encode('victim bytes'),
      );

      const traversal = `../victim-company/${HASH_A}`;
      expect(readInboundFile('attacker-company', traversal, 'application/pdf')).toBeNull();
    });

    it('readInboundFile returns null for a traversal-shaped value even when it also happens to be 64 characters long', () => {
      const traversal = `../${'x'.repeat(61)}`; // 64 chars total, but not hex and contains "/"
      expect(traversal).toHaveLength(64);
      expect(readInboundFile('company-1', traversal, 'application/pdf')).toBeNull();
    });

    it('readInboundFile returns null for an uppercase or short/long hash — not the exact 64 lowercase hex shape', () => {
      expect(readInboundFile('company-1', HASH_A.toUpperCase(), 'application/pdf')).toBeNull();
      expect(readInboundFile('company-1', HASH_A.slice(0, 63), 'application/pdf')).toBeNull();
      expect(readInboundFile('company-1', `${HASH_A}a`, 'application/pdf')).toBeNull();
    });

    it('persistInboundFile throws rather than writing outside the company directory', () => {
      expect(() =>
        persistInboundFile(
          'company-1',
          '../../etc/cron.d/x',
          'application/pdf',
          new TextEncoder().encode('x'),
        ),
      ).toThrow(/not a valid content hash/);
    });
  });
});
