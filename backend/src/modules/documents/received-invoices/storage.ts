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

/** `<root>/<companyId>/<sha256>.<ext>` — `sha256` is UNTRUSTED input on the read path (see
 *  `SHA256_HEX_PATTERN`'s own comment), so this rejects anything that is not a genuine SHA-256 hex
 *  digest before it ever becomes part of a path. The hex check alone already stops a `sha256` like
 *  `"../otherCompanyId/deadbeef...".slice(0, 64)` (`/`/`.` are not hex digits), but this only builds
 *  the path — it does NOT resolve `root` and re-check containment itself; each of
 *  `persistInboundFile`/`readInboundFile` below does that redundantly, in its OWN body, immediately
 *  before the actual disk access, rather than trust that a check run inside this helper two calls
 *  earlier still holds by the time the write/read happens. */
function inboundPath(companyId: string, sha256: string, mime: string): string {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new Error(`"${sha256}" is not a valid content hash (expected 64 lowercase hex characters).`);
  }
  return resolve(inboundRoot(), companyId, `${sha256}.${extFor(mime)}`);
}

/** Writes `bytes` under `<root>/<companyId>/<sha256>.<ext>` — `sha256` is computed by the CALLER
 *  (`archive/hashing.ts#computeArtifactHash`, reused as-is rather than duplicated: a plain SHA-256
 *  over one artifact's own bytes is exactly what that function already does) and never recomputed
 *  here, the one difference from `archive/storage.ts#persistArtifacts` (which hashes internally) —
 *  this module's own caller needs the hash BEFORE persisting, to run the duplicate-upload check
 *  first (`received-invoices.service.ts`), so recomputing it a second time here would be pure waste. */
export function persistInboundFile(
  companyId: string,
  sha256: string,
  mime: string,
  bytes: Uint8Array,
): string {
  const root = resolve(inboundRoot(), companyId);
  const path = inboundPath(companyId, sha256, mime);
  // Belt-and-suspenders, right where the write actually happens: `inboundPath`'s own hex-pattern
  // check already rules out a traversal shape, but re-resolving `root` here and refusing a `path`
  // that does not land INSIDE it is what proves, at the exact call site touching disk, that this
  // write can never escape this company's own directory.
  if (path !== root && !path.startsWith(root + sep)) {
    throw new Error(`Refusing to read/write outside this company's own storage directory.`);
  }
  mkdirSync(join(inboundRoot(), companyId), { recursive: true });
  writeFileSync(path, Buffer.from(bytes));
  return `file://${path}`;
}

/** Reads back exactly what `persistInboundFile` wrote — `null` (never throws) for a missing file,
 *  the same "a missing artifact is a fact to report, not an exception to crash the request over"
 *  discipline `archive/storage.ts#readArchivedArtifact` already holds. */
export function readInboundFile(companyId: string, sha256: string, mime: string): Buffer | null {
  try {
    const root = resolve(inboundRoot(), companyId);
    const path = inboundPath(companyId, sha256, mime);
    // Same check as `persistInboundFile` above, for the same reason: proven again, here, right
    // before the read, rather than trusted from a helper this function merely called.
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`Refusing to read/write outside this company's own storage directory.`);
    }
    return readFileSync(path);
  } catch {
    return null;
  }
}
