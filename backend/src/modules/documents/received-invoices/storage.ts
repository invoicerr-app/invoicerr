/**
 * Content-hash-addressed persistence for UPLOADED INBOUND files — local disk, or S3-compatible object
 * storage, selected by `INBOUND_STORAGE` (`'s3'` or, the default, anything else including unset).
 * Picks up the exact shape `archive/storage.ts` already proved for the legal archive (see that file's
 * own header for the reasoning this reuses): `inboundRoot()` is re-read on EVERY call, never cached,
 * so a test can repoint `DOCUMENTS_INBOUND_DIR` to a fresh `os.tmpdir()` subdirectory without ever
 * risking a write into the project's own working directory, and `INBOUND_STORAGE`/`INBOUND_S3_*` are
 * likewise read fresh on every call in `s3-storage.ts`.
 *
 * Scoped by `companyId` (`<root>/<companyId>/<sha256>.<ext>` locally, the identical
 * `<companyId>/<sha256>.<ext>` object-key shape on S3 — see `s3-storage.ts`), same reasoning
 * `archive/storage.ts` gives for including `documentId` in ITS OWN path: two different companies
 * whose uploaded files happen to hash identically (an unlikely but not impossible coincidence — the
 * same invoice template sent to two customers, byte for byte) must never share a stored path/key, and
 * a filename/key that leaked a bare SHA-256 keyed ONLY by hash would let one tenant's guessed hash
 * read another tenant's file. The hash ITSELF is still what makes a re-upload of the EXACT SAME file
 * idempotent (same path/key, overwritten with byte-identical content) — company scoping adds
 * isolation, not extra dedup logic.
 *
 * ## Dispatch shape — deliberately DIFFERENT from `archive/storage.ts`'s own
 * The archive facade dispatches WRITE on the current env var but READ/EXISTS/DELETE on the URI's OWN
 * scheme, because `DocumentArchive.uri` is a persisted DB column the archive can re-derive a provider
 * from years later. NOTHING calling into this module ever persists such a uri: every caller
 * (`received-invoices.service.ts`, `attachments/attachments.service.ts`,
 * `rendering/branding/logo-storage.ts`) keeps ONLY the content hash (`fileRef` / `AttachmentRef.
 * fileRef` / `Company.brandingLogoId`) and re-derives the read path from `(companyId, sha256, mime)`
 * alone — `persistInboundFile`'s own returned uri is discarded by every one of them today. So BOTH
 * write and read here dispatch on the CURRENT `INBOUND_STORAGE` value — there is no per-object marker
 * to dispatch on instead.
 *
 * ## What this means for an operator switching `INBOUND_STORAGE` mid-life
 * Flipping the env var does NOT migrate anything: a file written while `local` stays on local disk
 * only, and becomes UNREADABLE the moment `INBOUND_STORAGE=s3` takes effect (a read for its hash now
 * asks the bucket, which does not have it) — and symmetrically for a file written to S3 if the
 * operator later flips back to `local`. This is a real, deliberate limitation, not an oversight: fixing
 * it properly would mean every caller starting to PERSIST a provider-tagged uri (a schema change on
 * `DocumentInstance.data`/`AttachmentRef`/`Company.brandingLogoId`) and threading it through every read
 * call site, which is a real piece of work of its own and out of scope here. A CHEAP one-off migration
 * is possible without any of that, precisely because the key layout is identical on both sides: walk
 * `inboundRoot()`'s files and `PutObjectCommand` each one under the exact same `<companyId>/<sha256>.
 * <ext>` key it already has (or the reverse, `GetObjectCommand` + `writeFileSync`, for an S3-to-local
 * migration) — nothing here implements that; it is a deliberate omission, not a forgotten one.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import {
  deleteAllInboundObjectsS3,
  deleteInboundFilesForCompanyS3,
  persistInboundFileS3,
  readInboundFileS3,
} from './s3-storage';

/** Root of the LOCAL inbound-file store. `DOCUMENTS_INBOUND_DIR` if set (tests repoint it under
 *  `os.tmpdir()`); otherwise `<cwd>/.documents-inbound` — the same "dev-friendly default, gitignored"
 *  shape `archive/storage.ts`'s own `archiveRoot()` already holds for archived artifacts. Meaningless
 *  when `INBOUND_STORAGE=s3` (nothing local is ever written or read), but kept unconditional here
 *  (never gated on `INBOUND_STORAGE`) so a mid-life switch back to local still resolves the exact same
 *  root it always would have — same reasoning `archive/storage.ts#archiveRoot()`'s own header gives. */
export function inboundRoot(): string {
  return resolve(process.env.DOCUMENTS_INBOUND_DIR ?? join(process.cwd(), '.documents-inbound'));
}

/** A small, honest map — never a guess: an unrecognized mime gets `.bin`, exactly like
 *  `archive/storage.ts`'s own `extFor`. The three `image/*` entries were added for
 *  `attachments/attachments.service.ts` (enriched expense attachments, "notes de frais enrichies") — the
 *  first caller of this shared module to ever store a photo rather than a supplier document; extending
 *  this map (rather than letting a receipt photo fall through to `.bin`) is purely a cosmetic/
 *  operational nicety for a human browsing `DOCUMENTS_INBOUND_DIR` directly, never a functional
 *  requirement — `persistInboundFile`/`readInboundFile` both derive the path/key from `extFor` the SAME
 *  way, so a `.bin` round-trip would have worked identically either way. Shared verbatim with
 *  `s3-storage.ts`'s own object-key derivation — imported from here, never duplicated. */
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
 *  ever becomes part of a filesystem path OR an S3 object key. Exported so `s3-storage.ts` calls this
 *  exact same check rather than a second, hand-duplicated regex. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Throws unless `sha256` is a genuine SHA-256 hex digest — called first thing, by value, in every
 *  read/write path in this module AND in `s3-storage.ts`, so neither ever builds so much as a partial
 *  path/key out of an unvalidated string. The hex check alone already stops a `sha256` like
 *  `"../otherCompanyId/deadbeef...".slice(0, 64)` (`/`/`.` are not hex digits) — true for a filesystem
 *  path (the local check below) AND for an S3 key (which does not "resolve" `..` segments the way a
 *  filesystem does, but a validated hex-only string can never contain one in the first place). */
export function assertValidContentHash(sha256: string): void {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new Error(`"${sha256}" is not a valid content hash (expected 64 lowercase hex characters).`);
  }
}

// ---------------------------------------------------------------------------------------------
// Local filesystem implementation — behavior UNCHANGED from before this file became a dispatching
// facade; only renamed (`*Local` suffix, private to this module) — see `archive/storage.ts`'s own
// identical note on its own `*Local` helpers.
// ---------------------------------------------------------------------------------------------

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
function persistInboundFileLocal(companyId: string, sha256: string, mime: string, bytes: Uint8Array): string {
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

/** Reads back exactly what `persistInboundFileLocal` wrote — `null` (never throws) for a missing file,
 *  the same "a missing artifact is a fact to report, not an exception to crash the request over"
 *  discipline `archive/storage.ts#readArchivedArtifact` already holds. Same `target`-built-then-
 *  checked-then-used shape as the write above, proven again here rather than trusted from a shared
 *  helper, right before the read that actually touches disk. */
function readInboundFileLocal(companyId: string, sha256: string, mime: string): Buffer | null {
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

/** Deletes every inbound file this company has ever stored in ONE call — received-invoice deposits
 *  AND expense attachments AND branding logos alike, since all three go through this exact same
 *  content-hash-addressed store (see this file's own header) under the SAME `<root>/<companyId>`
 *  directory. `force: true` makes a company that never uploaded anything (no directory to remove) a
 *  silent no-op rather than an error — the same "a missing artifact is a fact, not a failure" posture
 *  `archive/storage.ts`'s own delete/read functions already hold. */
function deleteInboundFilesForCompanyLocal(companyId: string): void {
  const root = resolve(inboundRoot(), companyId);
  rmSync(root, { recursive: true, force: true });
}

/** Wipes the ENTIRE local inbound root — every company's files at once — then recreates it empty so
 *  the next upload does not have to `mkdirSync` its way past a missing root. Used only by
 *  `InstanceResetService` ("reset this ENTIRE deployment" — every company, not one). */
function wipeAllInboundFilesLocal(): void {
  const root = inboundRoot();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

// ---------------------------------------------------------------------------------------------
// Public, provider-dispatching API — the ONLY names anything outside this module (and
// `s3-storage.ts`, which is imported ONLY from here — see this file's own header) may import.
// ---------------------------------------------------------------------------------------------

/** Persists `bytes` content-addressed under `companyId`, on whichever provider `INBOUND_STORAGE`
 *  currently names (`'s3'`, or local disk otherwise — read FRESH on every call, never hoisted into a
 *  module-level constant, same discipline `archive/storage.ts#persistArtifacts`'s own header
 *  documents). Returns a provider-tagged uri (`file://…` / `s3://…`) for interface parity with the
 *  archive facade — see this file's own header on why, unlike the archive, NOTHING today actually
 *  keeps that returned uri around for a later read. */
export async function persistInboundFile(
  companyId: string,
  sha256: string,
  mime: string,
  bytes: Uint8Array,
): Promise<string> {
  if (process.env.INBOUND_STORAGE === 's3') {
    return persistInboundFileS3(companyId, sha256, mime, bytes);
  }
  return persistInboundFileLocal(companyId, sha256, mime, bytes);
}

/** Reads back exactly what `persistInboundFile` wrote for this `(companyId, sha256, mime)` triple —
 *  `null` (never throws) for a missing file/object, OR for a `sha256` that fails
 *  `assertValidContentHash` (see `s3-storage.ts#readInboundFileS3`'s own note on why that check is a
 *  MISS here rather than a thrown error, matching the local implementation above). Dispatches on the
 *  CURRENT `INBOUND_STORAGE` value — see this file's own header for why this is NOT a uri-scheme
 *  dispatch the way `archive/storage.ts#readArchivedArtifact` is. */
export async function readInboundFile(
  companyId: string,
  sha256: string,
  mime: string,
): Promise<Buffer | null> {
  if (process.env.INBOUND_STORAGE === 's3') {
    return readInboundFileS3(companyId, sha256, mime);
  }
  return readInboundFileLocal(companyId, sha256, mime);
}

/** Deletes every inbound file ONE company has ever stored — used only by
 *  `danger/danger.service.ts#resetCompanyData` ("reset this company's data" keeps the company but
 *  wipes everything it uploaded); nothing else in this codebase ever deletes a single company's own
 *  files short of the whole-instance wipe below. */
export async function deleteInboundFilesForCompany(companyId: string): Promise<void> {
  if (process.env.INBOUND_STORAGE === 's3') {
    return deleteInboundFilesForCompanyS3(companyId);
  }
  return deleteInboundFilesForCompanyLocal(companyId);
}

/** Wipes EVERY company's inbound files at once — used only by
 *  `instance/instance-reset.service.ts#reset` ("reset this ENTIRE deployment"). Local mode recreates
 *  the (now empty) root directory immediately, matching the pre-existing behavior this function
 *  replaces; S3 mode has no directory to recreate — an empty bucket needs no equivalent step. */
export async function wipeAllInboundFiles(): Promise<void> {
  if (process.env.INBOUND_STORAGE === 's3') {
    return deleteAllInboundObjectsS3();
  }
  return wipeAllInboundFilesLocal();
}
