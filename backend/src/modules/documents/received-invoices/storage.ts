/**
 * Local, content-hash-addressed persistence for UPLOADED INBOUND files — root TODO item 18. Imitates
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
import { join, resolve } from 'node:path';

/** Root of the inbound-file store. `DOCUMENTS_INBOUND_DIR` if set (tests repoint it under
 *  `os.tmpdir()`); otherwise `<cwd>/.documents-inbound` — the same "dev-friendly default, gitignored"
 *  shape `archive/storage.ts`'s own `archiveRoot()` already holds for archived artifacts. */
export function inboundRoot(): string {
  return resolve(process.env.DOCUMENTS_INBOUND_DIR ?? join(process.cwd(), '.documents-inbound'));
}

/** A small, honest map — never a guess: an unrecognized mime gets `.bin`, exactly like
 *  `archive/storage.ts`'s own `extFor`. */
export function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml' || mime === 'text/xml') return 'xml';
  return 'bin';
}

function inboundPath(companyId: string, sha256: string, mime: string): string {
  return join(inboundRoot(), companyId, `${sha256}.${extFor(mime)}`);
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
  const path = inboundPath(companyId, sha256, mime);
  mkdirSync(join(inboundRoot(), companyId), { recursive: true });
  writeFileSync(path, Buffer.from(bytes));
  return `file://${path}`;
}

/** Reads back exactly what `persistInboundFile` wrote — `null` (never throws) for a missing file,
 *  the same "a missing artifact is a fact to report, not an exception to crash the request over"
 *  discipline `archive/storage.ts#readArchivedArtifact` already holds. */
export function readInboundFile(companyId: string, sha256: string, mime: string): Buffer | null {
  try {
    return readFileSync(inboundPath(companyId, sha256, mime));
  } catch {
    return null;
  }
}
