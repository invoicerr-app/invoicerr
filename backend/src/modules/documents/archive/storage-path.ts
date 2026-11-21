/** A small, honest mime-to-extension map, never a guess: an unrecognized mime gets `.bin`. A leaf
 *  module so `s3-storage.ts` and `storage.ts` can both use it without importing each other. */
export function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml') return 'xml';
  // `verdict-artifact.ts`'s own canonical VERDICT representation, legible on disk (`.json`, not the
  // `.bin` fallback below) for a human auditor opening a WORM archive directory directly.
  if (mime === 'application/json') return 'json';
  return 'bin';
}
