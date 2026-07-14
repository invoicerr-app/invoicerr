/**
 * Direct unit tests for the two ArchiveProvider implementations (M-3, archival-provider half).
 * Proves the honesty fix: a real SHA-256 content hash (not the old 'stub-sha256'), and — for
 * LocalArchiveProvider — real bytes actually written to disk. See archive-registry.spec.ts for
 * provider *selection* (residency routing); this file is about what store() actually does.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingComplianceLogger } from '../../execution/logger';
import { SignedArtifact } from '../../execution/types';
import { ArchivalPolicy } from '../../profiles/schema';
import { LocalArchiveProvider, WormS3ArchiveProvider } from './providers';

function artifact(
  role: SignedArtifact['role'],
  syntax: SignedArtifact['syntax'],
  mime: string,
  text: string,
): SignedArtifact {
  return { role, syntax, mime, bytes: new Uint8Array(Buffer.from(text, 'utf8')) };
}

function baseArtifacts(): SignedArtifact[] {
  return [
    artifact('AUTHORITATIVE', 'EN16931_CII', 'application/xml', '<Invoice>A</Invoice>'),
    artifact('HUMAN', 'FACTURX', 'application/pdf', '%PDF-1.4 fake'),
  ];
}

function policy(overrides: Partial<ArchivalPolicy> = {}): ArchivalPolicy {
  return { retentionYears: 10, archivedForm: 'BOTH', integrity: 'HASH_CHAIN', ...overrides };
}

/** Independently computed reference digest — mirrors the framing storage.ts documents (not a tautology). */
function referenceHash(artifacts: SignedArtifact[]): string {
  const h = createHash('sha256');
  for (const a of artifacts) {
    h.update(`${a.role}|${a.syntax}|${a.mime}|${a.bytes.length}\n`, 'utf8');
    h.update(a.bytes);
  }
  return h.digest('hex');
}

describe('archive providers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'compliance-archive-test-'));
    process.env.COMPLIANCE_ARCHIVE_DIR = root;
  });

  afterEach(() => {
    delete process.env.COMPLIANCE_ARCHIVE_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  describe.each<[string, () => LocalArchiveProvider | WormS3ArchiveProvider]>([
    ['local', () => new LocalArchiveProvider()],
    ['s3-worm', () => new WormS3ArchiveProvider()],
  ])('%s — content hash', (_name, makeProvider) => {
    it('returns a real 64-hex-char SHA-256, matching an independently computed digest', () => {
      const artifacts = baseArtifacts();
      const receipt = makeProvider().store(artifacts, policy(), new RecordingComplianceLogger());

      expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.contentHash).toBe(referenceHash(artifacts));
      expect(receipt.contentHash).not.toBe('stub-sha256');
    });

    it('is deterministic for identical artifacts', () => {
      const log = new RecordingComplianceLogger();
      const a = makeProvider().store(baseArtifacts(), policy(), log);
      const b = makeProvider().store(baseArtifacts(), policy(), log);
      expect(a.contentHash).toBe(b.contentHash);
    });

    it('changes when a single artifact byte changes', () => {
      const log = new RecordingComplianceLogger();
      const original = makeProvider().store(baseArtifacts(), policy(), log);

      const mutated = baseArtifacts();
      mutated[0] = artifact('AUTHORITATIVE', 'EN16931_CII', 'application/xml', '<Invoice>B</Invoice>');
      const changed = makeProvider().store(mutated, policy(), log);

      expect(changed.contentHash).not.toBe(original.contentHash);
    });

    it('still computes a real hash + stores bytes under integrity NONE (e.g. Germany-style policy)', () => {
      const receipt = makeProvider().store(
        baseArtifacts(),
        policy({ integrity: 'NONE' }),
        new RecordingComplianceLogger(),
      );
      expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(receipt.uri.replace('file://', ''))).toBe(true);
    });
  });

  describe('LocalArchiveProvider — real persistence', () => {
    it('writes each artifact to disk with the exact bytes, at the returned file:// uri', () => {
      const provider = new LocalArchiveProvider();
      const artifacts = baseArtifacts();
      const receipt = provider.store(artifacts, policy(), new RecordingComplianceLogger());

      expect(receipt.uri.startsWith('file://')).toBe(true);
      expect(receipt.uri).not.toContain('/stub');
      const dir = receipt.uri.replace('file://', '');
      expect(existsSync(dir)).toBe(true);

      const authFile = join(dir, 'authoritative-en16931_cii.xml');
      const humanFile = join(dir, 'human-facturx.pdf');
      expect(readFileSync(authFile)).toEqual(Buffer.from(artifacts[0].bytes));
      expect(readFileSync(humanFile)).toEqual(Buffer.from(artifacts[1].bytes));
    });

    it('is idempotent: re-storing identical artifacts resolves to the same path, no duplicate files', () => {
      const provider = new LocalArchiveProvider();
      const log = new RecordingComplianceLogger();

      const first = provider.store(baseArtifacts(), policy(), log);
      const dir = first.uri.replace('file://', '');
      const filesAfterFirst = readdirSync(dir).sort();

      const second = provider.store(baseArtifacts(), policy(), log);
      const third = provider.store(baseArtifacts(), policy(), log);

      expect(second.uri).toBe(first.uri);
      expect(third.uri).toBe(first.uri);
      expect(readdirSync(dir).sort()).toEqual(filesAfterFirst);
      expect(filesAfterFirst).toHaveLength(2);
    });

    it('a changed artifact set is stored at a different (content-hash-keyed) path', () => {
      const provider = new LocalArchiveProvider();
      const log = new RecordingComplianceLogger();
      const original = provider.store(baseArtifacts(), policy(), log);

      const mutated = baseArtifacts();
      mutated[0] = artifact('AUTHORITATIVE', 'EN16931_CII', 'application/xml', '<Invoice>changed</Invoice>');
      const changed = provider.store(mutated, policy(), log);

      expect(changed.uri).not.toBe(original.uri);
    });

    it('defaults to <cwd>/.compliance-archive when COMPLIANCE_ARCHIVE_DIR is unset', () => {
      delete process.env.COMPLIANCE_ARCHIVE_DIR;
      const provider = new LocalArchiveProvider();
      const receipt = provider.store(baseArtifacts(), policy(), new RecordingComplianceLogger());
      try {
        expect(receipt.uri).toContain(join(process.cwd(), '.compliance-archive'));
      } finally {
        // clean up the real default dir this test necessarily wrote into
        rmSync(join(process.cwd(), '.compliance-archive'), { recursive: true, force: true });
        process.env.COMPLIANCE_ARCHIVE_DIR = root;
      }
    });
  });

  describe('WormS3ArchiveProvider — honest fallback (no S3 credentials in this environment)', () => {
    it('never claims an s3:// uri for bytes it did not actually PUT to S3', () => {
      const log = new RecordingComplianceLogger();
      const receipt = new WormS3ArchiveProvider().store(baseArtifacts(), policy({ residency: 'MX' }), log);

      expect(receipt.uri.startsWith('s3://')).toBe(false);
      expect(receipt.uri.startsWith('file://')).toBe(true);
      expect(existsSync(receipt.uri.replace('file://', ''))).toBe(true);
    });

    it('logs a todo explaining the fallback (does not silently pretend WORM happened)', () => {
      const log = new RecordingComplianceLogger();
      new WormS3ArchiveProvider().store(baseArtifacts(), policy({ residency: 'MX' }), log);

      expect(log.hasScope('archive/s3-worm')).toBe(true);
      const todo = log.entries.find((e) => e.level === 'todo' && e.scope === 'archive/s3-worm');
      expect(todo?.message).toMatch(/S3/i);
    });

    it('region still reflects the requested residency even though storage fell back to local', () => {
      const receipt = new WormS3ArchiveProvider().store(
        baseArtifacts(),
        policy({ residency: 'BR' }),
        new RecordingComplianceLogger(),
      );
      expect(receipt.region).toBe('BR');
    });
  });

  it('no provider anywhere in this module returns the old fabricated hash', () => {
    const log = new RecordingComplianceLogger();
    const local = new LocalArchiveProvider().store(baseArtifacts(), policy(), log);
    const worm = new WormS3ArchiveProvider().store(baseArtifacts(), policy(), log);
    expect(local.contentHash).not.toBe('stub-sha256');
    expect(worm.contentHash).not.toBe('stub-sha256');
  });
});
