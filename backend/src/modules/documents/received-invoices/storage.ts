/**
 * Local, content-hash-addressed persistence for UPLOADED INBOUND files. Imitates
 * `archive/storage.ts` (see that file's own header for the reasoning this reuses): `inboundRoot()` is
 * re-read on EVERY call, never cached, so a test can repoint `DOCUMENTS_INBOUND_DIR` to a fresh
 * `os.tmpdir()` subdirectory without ever risking a write into the project's own working directory.
 *
 * Scoped by `companyId` (`<root>/<companyId>/<sha256>.<ext>`), same reasoning `archive/storage.ts`
 * gives for including `documentId` in ITS OWN path: two different companies whose uploaded files
 * happen to hash identically (an unlikely but not impossible coincidence — the same invoice template
 * sent to two customers, byte for byte) must never share a stored path, and a filename that leaked a
 * bare SHA-256 keyed ONLY by hash would let one tenant's guessed hash read another tenant's file.
 * The hash ITSELF is still what makes a re-upload of the EXACT SAME file idempotent (same path,
 * overwritten with byte-identical content) — company scoping adds isolation, not extra dedup logic.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Root of the inbound-file store. `DOCUMENTS_INBOUND_DIR` if set (tests repoint it under
 *  `os.tmpdir()`); otherwise `<cwd>/.documents-inbound` — the same "dev-friendly default, gitignored"
 *  shape `archive/storage.ts`'s own `archiveRoot()` already holds for archived artifacts. */
export function inboundRoot(): string {
  return resolve(process.env.DOCUMENTS_INBOUND_DIR ?? join(process.cwd(), '.documents-inbound'));
}

/** A small, honest map — never a guess: an unrecognized mime gets `.bin`, exactly like
 *  `archive/storage.ts`'s own `extFor`. The three `image/*` entries were added for
 *  `attachments/attachments.service.ts` (enriched expense attachments, "notes de frais enrichies") — the
 *  first caller of this shared module to ever store a photo rather than a supplier document; extending
 *  this map (rather than letting a receipt photo fall through to `.bin`) is purely a cosmetic/
 *  operational nicety for a human browsing `DOCUMENTS_INBOUND_DIR` directly, never a functional
 *  requirement — `persistInboundFile`/`readInboundFile` both derive the path from `extFor` the SAME
 *  way, so a `.bin` round-trip would have worked identically either way. */
export function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml' || mime === 'text/xml') return 'xml';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

/** What `archive/hashing.ts#computeArtifactHash` always produces — lowercase, exactly 64 hex
 *  characters. `sha256` reaches this module straight off an HTTP route param on more than one caller
 *  (`documents.controller.ts#downloadAttachment`'s `:fileRef`, echoed through
 *  `AttachmentsService.download`) — never validated there, so it must be validated HERE, before it
 *  ever becomes part of a filesystem path. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Throws unless `sha256` is a genuine SHA-256 hex digest — called first thing, by value, in both
 *  functions below, so neither ever builds so much as a partial path out of an unvalidated string.
 *  The hex check alone already stops a `sha256` like `"../otherCompanyId/deadbeef...".slice(0, 64)`
 *  (`/`/`.` are not hex digits). */
function assertValidContentHash(sha256: string): void {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new Error(`"${sha256}" is not a valid content hash (expected 64 lowercase hex characters).`);
  }
}

/** Writes `bytes` under `<root>/<companyId>/<sha256>.<ext>` — `sha256` is computed by the CALLER
 *  (`archive/hashing.ts#computeArtifactHash`, reused as-is rather than duplicated: a plain SHA-256
 *  over one artifact's own bytes is exactly what that function already does) and never recomputed
 *  here, the one difference from `archive/storage.ts#persistArtifacts` (which hashes internally) —
 *  this module's own caller needs the hash BEFORE persisting, to run the duplicate-upload check
 *  first (`received-invoices.service.ts`), so recomputing it a second time here would be pure waste.
 *
 *  `target` is resolved directly in THIS function, from `root`, and is the exact identifier both the
 *  containment check and the `fs` call below use — never a path handed back by some other helper two
 *  calls removed from the write, which would leave the check proving something about a value that
 *  isn't the one actually reaching disk. */
export function persistInboundFile(
  companyId: string,
  sha256: string,
  mime: string,
  bytes: Uint8Array,
): string {
  assertValidContentHash(sha256);
  const root = resolve(inboundRoot(), companyId);
  const target = resolve(root, `${sha256}.${extFor(mime)}`);
  if (!target.startsWith(root + sep)) {
    throw new Error(`Refusing to read/write outside this company's own storage directory.`);
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(target, Buffer.from(bytes));
  return `file://${target}`;
}

/** Reads back exactly what `persistInboundFile` wrote — `null` (never throws) for a missing file,
 *  the same "a missing artifact is a fact to report, not an exception to crash the request over"
 *  discipline `archive/storage.ts#readArchivedArtifact` already holds. Same `target`-built-then-
 *  checked-then-used shape as `persistInboundFile` above, proven again here rather than trusted from
 *  a shared helper, right before the read that actually touches disk. */
export function readInboundFile(companyId: string, sha256: string, mime: string): Buffer | null {
  try {
    assertValidContentHash(sha256);
    const root = resolve(inboundRoot(), companyId);
    const target = resolve(root, `${sha256}.${extFor(mime)}`);
    if (!target.startsWith(root + sep)) {
      throw new Error(`Refusing to read/write outside this company's own storage directory.`);
    }
    return readFileSync(target);
  } catch {
    return null;
  }
}
