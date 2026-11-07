/** A small, honest mime-to-extension map, never a guess: an unrecognized mime gets `.bin`. A leaf
 *  module so `s3-storage.ts` and `storage.ts` can both use it without importing each other. */
export function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml' || mime === 'text/xml') return 'xml';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

/** What `archive/hashing.ts#computeArtifactHash` always produces: lowercase, exactly 64 hex
 *  characters. `sha256` reaches this module straight off an HTTP route param on more than one caller
 *  (`documents.controller.ts#downloadAttachment`'s `:fileRef`, echoed through
 *  `AttachmentsService.download`) and never validated there, so it must be validated in this leaf
 *  before it ever becomes part of a filesystem path OR an S3 object key. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Throws unless `sha256` is a genuine SHA-256 hex digest, called first thing, by value, in every
 *  read/write path in the inbound-storage module AND in `s3-storage.ts`, so neither ever builds so
 *  much as a partial path/key out of an unvalidated string. The hex check alone already stops a
 *  `sha256` like `"../otherCompanyId/deadbeef...".slice(0, 64)` (`/`/`.` are not hex digits), true
 *  for a filesystem path AND for an S3 key. */
export function assertValidContentHash(sha256: string): void {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new Error(`"${sha256}" is not a valid content hash (expected 64 lowercase hex characters).`);
  }
}
