/**
 * Shared persistence helpers used by both ArchiveProvider implementations (providers.ts):
 * LocalArchiveProvider and — as its honest local-fallback — WormS3ArchiveProvider. Kept out of
 * providers.ts so both providers hash/write bytes identically instead of each rolling its own
 * (and inevitably drifting) version.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact } from '../../execution/types';

/**
 * Real SHA-256 over every artifact, in array order. Each artifact is framed with a stable header
 * (`role|syntax|mime|byteLength\n`) before its raw bytes so the digest:
 *   - covers every stored artifact, not just the first one;
 *   - is unambiguous about where one artifact's bytes end and the next start (a plain
 *     concatenation of bytes would let two different artifact sets collide/shift into the same
 *     digest — the length-prefixed header rules that out);
 *   - changes if any artifact's bytes are mutated, or if an artifact is added/removed/reordered.
 * Deterministic for identical input. Returns lowercase hex (64 chars for SHA-256).
 */
export function computeContentHash(artifacts: SignedArtifact[]): string {
  const hash = createHash('sha256');
  for (const artifact of artifacts) {
    hash.update(`${artifact.role}|${artifact.syntax}|${artifact.mime}|${artifact.bytes.length}\n`, 'utf8');
    hash.update(artifact.bytes);
  }
  return hash.digest('hex');
}

/**
 * Archive root directory. `COMPLIANCE_ARCHIVE_DIR` when set (tests point this at an os.tmpdir()
 * subdir); otherwise `<cwd>/.compliance-archive` — a dev-friendly on-disk default, mirroring
 * LocalStorageProvider's configured-directory pattern (plugins/storage/providers/local/local.ts).
 * Read fresh on every call (not cached at module load) so tests can repoint it between cases.
 */
function archiveRoot(): string {
  return resolve(process.env.COMPLIANCE_ARCHIVE_DIR ?? join(process.cwd(), '.compliance-archive'));
}

function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml') return 'xml';
  return 'bin';
}

/**
 * Writes every artifact's bytes to `<root>/<region>/<contentHash>/<role>-<syntax>.<ext>` and
 * returns the absolute directory written into. `store()` receives no document id (see
 * ArchiveProvider) — the content hash IS the stable key, so re-archiving byte-identical artifacts
 * resolves to the same path and overwrites in place (idempotent, no duplication), while archiving
 * a changed artifact set naturally lands at a different path.
 *
 * Storage happens unconditionally regardless of `policy.integrity` — a 'NONE' integrity policy
 * (e.g. Germany) still gets bytes stored and a real hash computed; 'NONE' only means the caller
 * doesn't require a signed/hash-chained artifact, not that archiving itself is optional.
 */
export function persistArtifacts(
  artifacts: SignedArtifact[],
  region: string,
  contentHash: string,
  log: ComplianceLogger,
  scope: string,
): string {
  const dir = join(archiveRoot(), region, contentHash);
  mkdirSync(dir, { recursive: true });
  for (const artifact of artifacts) {
    const fileName = `${artifact.role}-${artifact.syntax}.${extFor(artifact.mime)}`.toLowerCase();
    writeFileSync(join(dir, fileName), Buffer.from(artifact.bytes));
  }
  log.info(scope, `persisted ${artifacts.length} artifact(s) to ${dir}`);
  return dir;
}
