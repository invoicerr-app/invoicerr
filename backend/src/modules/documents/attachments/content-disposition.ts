/**
 * The file-header helpers of this module, kept a leaf (node built-ins only): which mime an
 * attachment or an imported original may be served as, the filename extension and the
 * `Content-Disposition` value of issue #549's "Download original", and the one place the inline PDF
 * headers every PDF route sends are written (`sendInlinePdf`).
 */

/**
 * What this app accepts as an attachment TODAY - a receipt is a photo or a PDF. The one consumer
 * that exists (expense.descriptor.ts's `attachment` field) is what fixes this list; a SECOND consumer
 * needing a different allow-list would need this parameterized per field, which nothing here does yet
 * (never invented ahead of an actual second need - same discipline `archive/storage.ts#extFor`'s own
 * small, honest map already holds).
 */
export const ALLOWED_ATTACHMENT_MIMES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  // Issue #340 - importing a past document's original file: the legal archive of an imported
  // invoice/credit-note is a PDF for most sellers, but can be the structured XML a previous tool
  // issued (FatturaPA, KSeF FA(3), Factur-X/CII, XRechnung/UBL) - see archive/import-original.ts's
  // own header on why the original format is kept verbatim, never re-derived from a PDF alone.
  'application/xml',
  'text/xml',
];

/**
 * The extension `DocumentsService#downloadImportOriginal` (issue #549) puts on the filename it
 * hands back - presentation only, deliberately separate from `archive/storage.ts#extFor`, which
 * names the file this same artifact is written to ON DISK. Changing THAT map would silently break
 * reading back every archive already written under it; this one only ever affects a fresh
 * `Content-Disposition` header, so it is free to cover every mime `attachments.service.ts#
 * ALLOWED_ATTACHMENT_MIMES` accepts as an import original, images included, where `extFor` itself
 * still falls back to `.bin`.
 */
export function extensionForOriginalMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml' || mime === 'text/xml') return 'xml';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

/**
 * The mime `DocumentsService#downloadImportOriginal` actually serves - never the archive row's
 * stored value verbatim. That value came from whatever `mime` the ORIGINAL upload declared
 * (`attachments.service.ts#AttachmentUploadInput`, client-supplied, before #340's own import wrote
 * it into the `IMPORT_ORIGINAL` archive), so a row written by a build that once accepted a wider
 * mime, or one that predates a later tightening of the allow-list, must never be trusted as-is:
 * this is the one function deciding what this route is willing to tell a browser to do with the
 * bytes it is about to stream. `ALLOWED_ATTACHMENT_MIMES` is the exact set the import path itself
 * accepts today (`attachments.service.ts`) - anything outside it falls back to the inert
 * `application/octet-stream`, which every browser downloads rather than renders.
 */
export function safeOriginalMime(mime: string): string {
  return ALLOWED_ATTACHMENT_MIMES.includes(mime) ? mime : 'application/octet-stream';
}

/**
 * The ASCII-only `Content-Disposition` fallback filename (RFC 6266 section 4.3): every byte outside
 * printable ASCII (0x20-0x7E) - control characters INCLUDING CR/LF, and anything non-ASCII - becomes
 * `_`, and a literal quote or backslash is replaced the same way so the value can never break out of
 * the `filename="..."` quoted string it is embedded in. `displayNumber` (this function's only real
 * caller's own input) is the number the IMPORTED document's previous tool printed - never validated
 * against a charset, since #340 keeps it "exactly as entered" - so this is the one place issue #549's
 * code review asked for: header-injection and control-character safety belongs here, not upstream of
 * it, because upstream is exactly where the legal requirement is to keep the value verbatim.
 */
export function asciiContentDispositionFallback(value: string): string {
  const sanitized = Array.from(value)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code > 0x7e) return '_';
      if (ch === '"' || ch === '\\') return '_';
      return ch;
    })
    .join('');
  return sanitized || 'original';
}

/**
 * The UTF-8, percent-encoded `filename*` extension (RFC 5987/8187) that lets a compliant client
 * recover the real, accented/quoted/whatever-it-was file name the ASCII fallback above had to
 * mangle. Encodes every byte outside RFC 5987's own `attr-char` set (`ALPHA / DIGIT / "!" / "#" /
 * "$" / "&" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"`) - stricter than `encodeURIComponent`
 * alone, which leaves `'`, `(`, `)` and `*` unescaped even though RFC 5987 does not allow them
 * unescaped in this position.
 */
export function rfc5987Encode(value: string): string {
  const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const ch = String.fromCharCode(byte);
    out += ATTR_CHAR.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * The full `Content-Disposition` header value for issue #549's "Download original" - the one place
 * this repo builds this header from a value it did not itself generate (every OTHER
 * `Content-Disposition` in this module is built from `typeId`/`id`/a provider's own fixed `syntax`,
 * never a user-supplied string). Carries BOTH forms RFC 6266 documents for exactly this situation:
 * an ASCII-sanitized `filename=` every client understands, and a UTF-8 `filename*` a compliant one
 * prefers - see `asciiContentDispositionFallback`/`rfc5987Encode` above for what each strips or
 * encodes and why.
 */
export function buildOriginalContentDisposition(filename: string): string {
  const ascii = asciiContentDispositionFallback(filename);
  const encoded = rfc5987Encode(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The minimal slice of an Express `Response` `sendInlinePdf` writes to. */
export interface InlinePdfResponse {
  setHeader(name: string, value: string): unknown;
  send(body: Buffer): unknown;
}

/**
 * Writes one rendered PDF as an inline response: `Content-Type`, then `Content-Disposition` named
 * `<typeId>-<id>.pdf`, then (with `noStore`) `Cache-Control: private, no-store`, then the bytes.
 */
export function sendInlinePdf(
  res: InlinePdfResponse,
  typeId: string,
  id: string,
  bytes: Buffer,
  options: { noStore?: boolean } = {},
): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${typeId}-${id}.pdf"`);
  if (options.noStore) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  res.send(bytes);
}
