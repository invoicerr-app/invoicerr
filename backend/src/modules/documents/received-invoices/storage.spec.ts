import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi, type Mock } from 'vitest';

import * as s3Storage from './s3-storage';
import {
  deleteInboundFilesForCompany,
  extFor,
  inboundRoot,
  persistInboundFile,
  readInboundFile,
  wipeAllInboundFiles,
} from './storage';

vi.mock('./s3-storage');

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
  const originalInboundStorage = process.env.INBOUND_STORAGE;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-inbound-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    // Every test in this describe block exercises LOCAL mode specifically — see the "S3 dispatch"
    // describe block below for the `INBOUND_STORAGE=s3` path. Cleared explicitly rather than assumed
    // unset: a prior file in the same worker could otherwise leak this across files.
    delete process.env.INBOUND_STORAGE;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
    if (originalInboundStorage === undefined) delete process.env.INBOUND_STORAGE;
    else process.env.INBOUND_STORAGE = originalInboundStorage;
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

  it('persists under <root>/<companyId>/<sha256>.<ext>', async () => {
    const uri = await persistInboundFile(
      'company-1',
      HASH_A,
      'application/pdf',
      new TextEncoder().encode('%PDF-fake'),
    );
    expect(uri).toBe(`file://${join(dir, 'company-1', `${HASH_A}.pdf`)}`);
    expect(existsSync(join(dir, 'company-1', `${HASH_A}.pdf`))).toBe(true);
    expect(readFileSync(join(dir, 'company-1', `${HASH_A}.pdf`), 'utf-8')).toBe('%PDF-fake');
  });

  it('two DIFFERENT companies never share a path, even for the same hash', async () => {
    await persistInboundFile('company-1', HASH_B, 'application/xml', new TextEncoder().encode('company one'));
    await persistInboundFile('company-2', HASH_B, 'application/xml', new TextEncoder().encode('company two'));

    expect((await readInboundFile('company-1', HASH_B, 'application/xml'))?.toString('utf-8')).toBe(
      'company one',
    );
    expect((await readInboundFile('company-2', HASH_B, 'application/xml'))?.toString('utf-8')).toBe(
      'company two',
    );
  });

  it('re-persisting the SAME hash for the SAME company overwrites idempotently (dedup by hash)', async () => {
    await persistInboundFile('company-1', HASH_C, 'application/xml', new TextEncoder().encode('first'));
    await persistInboundFile('company-1', HASH_C, 'application/xml', new TextEncoder().encode('first')); // byte-identical
    expect((await readInboundFile('company-1', HASH_C, 'application/xml'))?.toString('utf-8')).toBe('first');
  });

  it('readInboundFile returns null (never throws) for a missing file', async () => {
    expect(await readInboundFile('company-1', HASH_D, 'application/pdf')).toBeNull();
  });

  // `sha256` reaches this module straight off an HTTP route param on more than one caller
  // (documents.controller.ts's `:fileRef`) — never validated there. These are the regression cases
  // for what happens when it is NOT the 64-hex-character digest this module's own callers always
  // compute: a traversal-shaped value must never escape the company's own directory, whether or not
  // a real file happens to sit where it points.
  describe('a "sha256" that is not a genuine content hash', () => {
    it("readInboundFile returns null for a path-traversal-shaped value, even one that resolves to a REAL file in another company's own directory", async () => {
      await persistInboundFile(
        'victim-company',
        HASH_A,
        'application/pdf',
        new TextEncoder().encode('victim bytes'),
      );

      const traversal = `../victim-company/${HASH_A}`;
      expect(await readInboundFile('attacker-company', traversal, 'application/pdf')).toBeNull();
    });

    it('readInboundFile returns null for a traversal-shaped value even when it also happens to be 64 characters long', async () => {
      const traversal = `../${'x'.repeat(61)}`; // 64 chars total, but not hex and contains "/"
      expect(traversal).toHaveLength(64);
      expect(await readInboundFile('company-1', traversal, 'application/pdf')).toBeNull();
    });

    it('readInboundFile returns null for an uppercase or short/long hash — not the exact 64 lowercase hex shape', async () => {
      expect(await readInboundFile('company-1', HASH_A.toUpperCase(), 'application/pdf')).toBeNull();
      expect(await readInboundFile('company-1', HASH_A.slice(0, 63), 'application/pdf')).toBeNull();
      expect(await readInboundFile('company-1', `${HASH_A}a`, 'application/pdf')).toBeNull();
    });

    it('persistInboundFile throws rather than writing outside the company directory, and refuses BEFORE touching disk', async () => {
      await expect(
        persistInboundFile(
          'company-1',
          '../../etc/cron.d/x',
          'application/pdf',
          new TextEncoder().encode('x'),
        ),
      ).rejects.toThrow(/not a valid content hash/);
      // Nothing was created anywhere under the root — the malformed hash never became part of a path.
      expect(existsSync(join(dir, 'company-1'))).toBe(false);
    });
  });

  describe('deleteInboundFilesForCompany (local)', () => {
    it("removes only the named company's own directory", async () => {
      await persistInboundFile('company-1', HASH_A, 'application/pdf', new TextEncoder().encode('mine'));
      await persistInboundFile('company-2', HASH_A, 'application/pdf', new TextEncoder().encode('theirs'));

      await deleteInboundFilesForCompany('company-1');

      expect(await readInboundFile('company-1', HASH_A, 'application/pdf')).toBeNull();
      expect((await readInboundFile('company-2', HASH_A, 'application/pdf'))?.toString('utf-8')).toBe(
        'theirs',
      );
    });

    it('is a silent no-op for a company that never uploaded anything', async () => {
      await expect(deleteInboundFilesForCompany('never-uploaded-company')).resolves.toBeUndefined();
    });
  });

  describe('wipeAllInboundFiles (local)', () => {
    it('removes every company at once, then recreates the root empty', async () => {
      await persistInboundFile('company-1', HASH_A, 'application/pdf', new TextEncoder().encode('a'));
      await persistInboundFile('company-2', HASH_A, 'application/pdf', new TextEncoder().encode('b'));

      await wipeAllInboundFiles();

      expect(existsSync(dir)).toBe(true);
      expect(await readInboundFile('company-1', HASH_A, 'application/pdf')).toBeNull();
      expect(await readInboundFile('company-2', HASH_A, 'application/pdf')).toBeNull();
    });
  });
});

/**
 * `storage.ts` dispatches EVERY function on the CURRENT `INBOUND_STORAGE` value (see that file's own
 * header on why this differs from `archive/storage.ts`'s own uri-scheme dispatch) — these tests prove
 * the dispatch itself, with `s3-storage.ts` mocked wholesale: the REAL S3 wiring is
 * `s3-storage.spec.ts`'s own concern (mocked SDK) and `s3-storage.live.spec.ts`'s (real MinIO).
 */
describe('received-invoices/storage — INBOUND_STORAGE=s3 dispatch', () => {
  const originalInboundStorage = process.env.INBOUND_STORAGE;

  beforeEach(() => {
    process.env.INBOUND_STORAGE = 's3';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalInboundStorage === undefined) delete process.env.INBOUND_STORAGE;
    else process.env.INBOUND_STORAGE = originalInboundStorage;
  });

  it('persistInboundFile routes to persistInboundFileS3', async () => {
    (s3Storage.persistInboundFileS3 as Mock).mockResolvedValue('s3://bucket/company-1/hash.pdf');
    const bytes = new TextEncoder().encode('x');

    const uri = await persistInboundFile('company-1', HASH_A, 'application/pdf', bytes);

    expect(uri).toBe('s3://bucket/company-1/hash.pdf');
    expect(s3Storage.persistInboundFileS3).toHaveBeenCalledWith(
      'company-1',
      HASH_A,
      'application/pdf',
      bytes,
    );
  });

  it('readInboundFile routes to readInboundFileS3', async () => {
    (s3Storage.readInboundFileS3 as Mock).mockResolvedValue(Buffer.from('s3 bytes'));

    const result = await readInboundFile('company-1', HASH_A, 'application/pdf');

    expect(result?.toString('utf-8')).toBe('s3 bytes');
    expect(s3Storage.readInboundFileS3).toHaveBeenCalledWith('company-1', HASH_A, 'application/pdf');
  });

  it('deleteInboundFilesForCompany routes to deleteInboundFilesForCompanyS3', async () => {
    (s3Storage.deleteInboundFilesForCompanyS3 as Mock).mockResolvedValue(undefined);

    await deleteInboundFilesForCompany('company-1');

    expect(s3Storage.deleteInboundFilesForCompanyS3).toHaveBeenCalledWith('company-1');
  });

  it('wipeAllInboundFiles routes to deleteAllInboundObjectsS3', async () => {
    (s3Storage.deleteAllInboundObjectsS3 as Mock).mockResolvedValue(undefined);

    await wipeAllInboundFiles();

    expect(s3Storage.deleteAllInboundObjectsS3).toHaveBeenCalled();
  });
});
