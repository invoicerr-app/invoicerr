/**
 * Durable local persistence for archived bytes — picks up the shape of `avant-refonte-documents:
 * backend/src/compliance/providers/archive/storage.ts#LocalArchiveProvider`/`persistArtifacts` (see
 * `providers.ts` in that same removed compliance engine for `WormS3ArchiveProvider`, whose HONESTY
 * NOTE this module's own implicit README carries forward: no S3 credentials exist here either, so NO
 * `s3://` provider is even attempted).
 *
 * `archiveRoot()` is re-read on EVERY call (never cached at module load) — exactly like the removed
 * compliance engine: a test can therefore repoint `DOCUMENTS_ARCHIVE_DIR` at an `os.tmpdir()` without
 * ever risking a write into the project's own working directory.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ArchivedArtifactInput, computeContentHash } from './hashing';

/** Root of the archive store. `DOCUMENTS_ARCHIVE_DIR` when set (tests repoint it at a subdirectory
 *  of `os.tmpdir()`); otherwise `<cwd>/.documents-archive` — the same "dev-friendly" default the
 *  removed compliance engine's `LocalArchiveProvider` used. Read fresh on EVERY call, never cached. */
export function archiveRoot(): string {
  return resolve(process.env.DOCUMENTS_ARCHIVE_DIR ?? join(process.cwd(), '.documents-archive'));
}

export function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml') return 'xml';
  // `verdict-artifact.ts`'s own canonical VERDICT representation — legible on disk (`.json`, not the
  // `.bin` fallback below) for a human auditor opening a WORM archive directory directly.
  if (mime === 'application/json') return 'json';
  return 'bin';
}

/** The directory where one archive's bytes live: content-hash-addressed, like the removed compliance
 *  engine — re-archiving a byte-identical artifact set lands back on the SAME path (idempotent, no
 *  duplication), while a modified set (so a different `contentHash`) lands elsewhere. `documentId`
 *  PARTICIPATES in the path (unlike the removed compliance engine, where the hash alone was enough):
 *  two distinct documents that produced — improbably but not impossibly — the same `contentHash`
 *  (the same PDF sent twice to different clients, byte for byte) must never share a directory, which
 *  would break the immutability of one of them the day the other got re-archived with different
 *  content. */
function archiveDir(documentId: string, contentHash: string): string {
  return join(archiveRoot(), documentId, contentHash);
}

/**
 * Writes each artifact under `<root>/<documentId>/<contentHash>/<role>.<ext>` and returns the
 * directory's `file://` URI. `contentHash` is computed HERE (never passed in by the caller) so it
 * can never drift from what these bytes, in this order, actually hash to.
 */
export function persistArtifacts(
  documentId: string,
  artifacts: ArchivedArtifactInput[],
): { uri: string; contentHash: string } {
  const contentHash = computeContentHash(artifacts);
  const dir = archiveDir(documentId, contentHash);
  mkdirSync(dir, { recursive: true });
  for (const artifact of artifacts) {
    const fileName = `${artifact.role}.${extFor(artifact.mime)}`.toLowerCase();
    writeFileSync(join(dir, fileName), Buffer.from(artifact.bytes));
  }
  return { uri: `file://${dir}`, contentHash };
}

/** Reads the bytes of an already-archived artifact, by its role/mime — used by `persistence.ts#verify`
 *  to re-hash what is actually on disk. `null` (never an exception) if the file no longer exists: a
 *  missing file IS one of the forms of corruption `verify` must name, not an error that would fail
 *  the entire HTTP call. */
export function readArchivedArtifact(uri: string, role: string, mime: string): Buffer | null {
  const dir = uri.replace(/^file:\/\//, '');
  const fileName = `${role}.${extFor(mime)}`.toLowerCase();
  try {
    return readFileSync(join(dir, fileName));
  } catch {
    return null;
  }
}
