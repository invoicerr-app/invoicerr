/**
 * Durable persistence for archived bytes — picks up the shape of `avant-refonte-documents:
 * backend/src/compliance/providers/archive/storage.ts#LocalArchiveProvider`/`persistArtifacts` (see
 * `providers.ts` in that same removed compliance engine for `WormS3ArchiveProvider`). Unlike this
 * module's own former state — no S3 credentials existed here, so no `s3://` provider was even
 * attempted — an S3-compatible provider now exists (`s3-storage.ts`), and THIS file is the
 * DISPATCHING FACADE in front of both it and the local filesystem. Every caller outside this file
 * (`persistence.ts` and this file's own spec) imports ONLY the four functions exported below — never
 * `s3-storage.ts` directly, and never any of this file's own `*Local` helpers.
 *
 * WRITE dispatch (`persistArtifacts`) reads `process.env.ARCHIVE_STORAGE` FRESH on every call (same
 * "never cached at module load" discipline `archiveRoot()` already documents, below): `'s3'` routes
 * to `s3-storage.ts`, anything else — including unset, the default — keeps today's local filesystem
 * behavior byte-for-byte.
 *
 * READ / EXISTS / DELETE dispatch (`readArchivedArtifact`, `artifactExists`,
 * `deleteArchivedArtifacts`) deliberately do NOT look at `ARCHIVE_STORAGE` at all — they dispatch on
 * the URI's OWN scheme (`file://` vs `s3://`). An operator who switches `ARCHIVE_STORAGE` later must
 * still be able to read/verify an archive written under the PREVIOUS provider:
 * `verifyDocumentArchive` (`persistence.ts`) re-hashes a stored archive's bytes on demand, potentially
 * long after `ARCHIVE_STORAGE` has changed value one or more times since that archive was written.
 * The URI stored in the `DocumentArchive.uri` column is self-describing and IS the source of truth
 * for where those bytes live today's env var only decides where the NEXT write goes, never where an
 * EXISTING one is read from.
 *
 * `archiveRoot()` is re-read on EVERY call (never cached at module level) — exactly like the removed
 * compliance engine: a test can therefore repoint `DOCUMENTS_ARCHIVE_DIR` at an `os.tmpdir()` without
 * ever risking a write into the project's own working directory.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ArchivedArtifactInput, computeContentHash } from './hashing';
import {
  artifactExistsS3,
  deleteArchivedArtifactsS3,
  listArchivedArtifactKeysS3,
  persistArtifactsS3,
  readArchivedArtifactS3,
} from './s3-storage';

/** Root of the LOCAL archive store. `DOCUMENTS_ARCHIVE_DIR` when set (tests repoint it at a
 *  subdirectory of `os.tmpdir()`); otherwise `<cwd>/.documents-archive` — the same "dev-friendly"
 *  default the removed compliance engine's `LocalArchiveProvider` used. Read fresh on EVERY call,
 *  never cached. Meaningless when `ARCHIVE_STORAGE=s3` (nothing local is ever written), but kept
 *  unconditional here (never gated on `ARCHIVE_STORAGE`) so a mid-life switch back to local still
 *  resolves the exact same root it always would have. */
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

/** The directory where one LOCAL archive's bytes live: content-hash-addressed, like the removed
 *  compliance engine — re-archiving a byte-identical artifact set lands back on the SAME path
 *  (idempotent, no duplication), while a modified set (so a different `contentHash`) lands elsewhere.
 *  `documentId` PARTICIPATES in the path (unlike the removed compliance engine, where the hash alone
 *  was enough): two distinct documents that produced — improbably but not impossibly — the same
 *  `contentHash` (the same PDF sent twice to different clients, byte for byte) must never share a
 *  directory, which would break the immutability of one of them the day the other got re-archived
 *  with different content. `s3-storage.ts` mirrors this exact same `<documentId>/<contentHash>/…`
 *  layout as its own object key prefix, for the identical reason. */
function archiveDir(documentId: string, contentHash: string): string {
  return join(archiveRoot(), documentId, contentHash);
}

// ---------------------------------------------------------------------------------------------
// Local filesystem implementation — behavior UNCHANGED from before this file became a dispatching
// facade; only renamed (`*Local` suffix, private to this module) and wrapped in `async` so their
// signature matches the exported dispatch functions', and the S3 implementation's, which genuinely
// does need to await network I/O. The underlying fs calls stay synchronous — this is a refactor, not
// a behavior change, for local mode.
// ---------------------------------------------------------------------------------------------

async function persistArtifactsLocal(
  documentId: string,
  artifacts: ArchivedArtifactInput[],
): Promise<{ uri: string; contentHash: string }> {
  const contentHash = computeContentHash(artifacts);
  const dir = archiveDir(documentId, contentHash);
  mkdirSync(dir, { recursive: true });
  for (const artifact of artifacts) {
    const fileName = `${artifact.role}.${extFor(artifact.mime)}`.toLowerCase();
    writeFileSync(join(dir, fileName), Buffer.from(artifact.bytes));
  }
  return { uri: `file://${dir}`, contentHash };
}

async function readArchivedArtifactLocal(uri: string, role: string, mime: string): Promise<Buffer | null> {
  const dir = uri.replace(/^file:\/\//, '');
  const fileName = `${role}.${extFor(mime)}`.toLowerCase();
  try {
    return readFileSync(join(dir, fileName));
  } catch {
    return null;
  }
}

async function artifactExistsLocal(uri: string, role: string, mime: string): Promise<boolean> {
  const dir = uri.replace(/^file:\/\//, '');
  const fileName = `${role}.${extFor(mime)}`.toLowerCase();
  return existsSync(join(dir, fileName));
}

/** Deletes the WHOLE directory for this archive's uri — every artifact it holds, in one call. See
 *  `deleteArchivedArtifacts`'s own doc comment below on why a delete function exists here at all
 *  despite `persistence.ts`'s own "no update or delete" WORM discipline. */
async function deleteArchivedArtifactsLocal(uri: string): Promise<void> {
  const dir = uri.replace(/^file:\/\//, '');
  rmSync(dir, { recursive: true, force: true });
}

/** Recursively walks `archiveRoot()` and returns one `file://<path>` entry per artifact FILE found
 *  (never a directory) — `[]`, not an error, when the root does not exist yet (a fresh instance that
 *  has never archived anything locally). See `listArchivedArtifactKeys`'s own doc comment for the
 *  "read by nothing yet" status this shares with its S3 counterpart. */
function listArchivedArtifactKeysLocal(): string[] {
  const root = archiveRoot();
  if (!existsSync(root)) return [];
  const keys: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else keys.push(`file://${full}`);
    }
  };
  walk(root);
  return keys;
}

// ---------------------------------------------------------------------------------------------
// Public, provider-dispatching API — the ONLY names `persistence.ts` (or anything else) may import
// from this module.
// ---------------------------------------------------------------------------------------------

/**
 * Writes each artifact under either `<root>/<documentId>/<contentHash>/<role>.<ext>` (local) or the
 * S3 object key of the same shape (see `s3-storage.ts`), and returns a provider-tagged URI
 * (`file://…` or `s3://…`). `contentHash` is computed HERE (never passed in by the caller) so it can
 * never drift from what these bytes, in this order, actually hash to — true for both providers,
 * since `computeContentHash` runs once, before dispatch.
 */
export async function persistArtifacts(
  documentId: string,
  artifacts: ArchivedArtifactInput[],
): Promise<{ uri: string; contentHash: string }> {
  // Read FRESH on every call — see this file's own header on why this must never be hoisted into a
  // module-level constant: a test (or a live process reconfigured at runtime, e.g. mid-migration)
  // must see a changed env var take effect on the very next write, not on the next restart.
  if (process.env.ARCHIVE_STORAGE === 's3') {
    return persistArtifactsS3(documentId, artifacts);
  }
  return persistArtifactsLocal(documentId, artifacts);
}

/** Reads the bytes of an already-archived artifact, by its role/mime — used by `persistence.ts#verify`
 *  to re-hash what is actually stored. `null` (never an exception) if the artifact no longer exists:
 *  a missing artifact IS one of the forms of corruption `verify` must name, not an error that would
 *  fail the entire HTTP call. Dispatches on `uri`'s scheme — see this file's own header. */
export async function readArchivedArtifact(uri: string, role: string, mime: string): Promise<Buffer | null> {
  if (uri.startsWith('s3://')) return readArchivedArtifactS3(uri, role, mime);
  return readArchivedArtifactLocal(uri, role, mime);
}

/** Cheap existence check (a local `existsSync`, or an S3 HEAD rather than a full GET) — added for
 *  interface parity across providers and for whatever future caller needs "does this artifact still
 *  exist" without paying for its bytes. Dispatches on `uri`'s scheme, same reasoning as
 *  `readArchivedArtifact` above. Not wired into any caller today. */
export async function artifactExists(uri: string, role: string, mime: string): Promise<boolean> {
  if (uri.startsWith('s3://')) return artifactExistsS3(uri, role, mime);
  return artifactExistsLocal(uri, role, mime);
}

/** Deletes every artifact stored under this archive's `uri` (the whole directory, locally; every
 *  object under the key prefix, on S3). Added for interface PARITY across providers, NOT because
 *  `persistence.ts` gained a delete path: see that file's own header — "NO update or delete function
 *  exists here", and that remains true. Nothing in this codebase calls this function; it exists so a
 *  future, deliberate deletion path (e.g. a retention-expiry sweep, if one is ever built — see
 *  `archive/retention/**`'s own "computes a date, purges nothing" scope note) has a provider-agnostic
 *  primitive to call rather than reinventing per-provider deletion at that point. Dispatches on
 *  `uri`'s scheme, same reasoning as the read/exists functions above. */
export async function deleteArchivedArtifacts(uri: string): Promise<void> {
  if (uri.startsWith('s3://')) return deleteArchivedArtifactsS3(uri);
  return deleteArchivedArtifactsLocal(uri);
}

/**
 * Enumerates every artifact currently stored, across BOTH providers — READ BY NOTHING YET,
 * deliberately (the same honest "read by nothing yet, deliberately" status this repository already
 * documents elsewhere, e.g. `domestic-reverse-charge/DESIGN.md`): nothing in this codebase lists
 * archive contents today (`billing/export-zip.service.ts` re-renders documents live rather than
 * reading archived bytes, and `archive/retention/**` only COMPUTES a `retentionUntil` date — nothing
 * purges or lists files on expiry). This exists for interface/contract completeness and for whatever
 * future retention-sweep or admin-audit tool eventually needs to enumerate the store, not for any
 * caller today.
 *
 * Deliberately "both providers, best-effort" rather than "whichever `ARCHIVE_STORAGE` currently
 * names": local keys are always included (cheap — no network call, and this repo's own local-first
 * default), and S3 keys are included whenever `ARCHIVE_S3_BUCKET` is set, REGARDLESS of the CURRENT
 * `ARCHIVE_STORAGE` value — the same "the URI outlives today's env var" reasoning the read/exists/
 * delete dispatch above already holds. An operator who migrated providers mid-life has real archives
 * sitting in BOTH places; a function whose whole purpose is "enumerate everything currently stored"
 * would be quietly wrong if it only ever reported one of them. If `ARCHIVE_S3_BUCKET` is unset (the
 * default, local-only setup), no S3 call is attempted at all — this must never throw for the common
 * case just because nobody configured S3.
 */
export async function listArchivedArtifactKeys(): Promise<string[]> {
  const keys = listArchivedArtifactKeysLocal();
  if (process.env.ARCHIVE_S3_BUCKET) {
    keys.push(...(await listArchivedArtifactKeysS3()));
  }
  return keys;
}
