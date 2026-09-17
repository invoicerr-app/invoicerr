/**
 * Upload validation for a received-invoice deposit — a THIRD PARTY (a supplier, an email attachment
 * gateway, a scan) hands this backend arbitrary bytes under a SELF-DECLARED filename and mime, and
 * `received-invoices.service.ts#upload` used to trust both blindly: any mime was accepted and the
 * actual bytes were never inspected, only "empty" and "exact duplicate" were refused.
 *
 * The allow-list below is not "anything a browser might upload" — it is exactly what something
 * downstream of this upload can ever actually read:
 *  - `extraction.ts` only ever parses XML (CII/UBL — "application/xml"/"text/xml") or unwraps a PDF
 *    (Factur-X — "application/pdf") — see that file's own header.
 *  - the ONLY OCR extension point this module can ever reach (`ocr/extractor.ts` →
 *    `plugins/ocr/providers/local/local.ts#supports`) answers `true` for "application/pdf" alone.
 * An image is therefore never read by anything downstream of THIS upload — unlike
 * `attachments/attachments.service.ts`'s OWN allow-list (expense receipts, a genuinely different
 * consumer that DOES render a photo back to a human) — so it is not offered here either.
 *
 * A declared Content-Type/mime is exactly as trustworthy as a file extension, i.e. not at all: the
 * ACTUAL bytes are sniffed against their own magic number before the file is ever written to disk
 * (`bytesMatchDeclaredMime` below). This closes the cross-route rendering risk
 * `documents.controller.ts#downloadAttachment` already documents for the shared inbound store this
 * module writes into (`received-invoices/storage.ts`): a `text/html` payload can no longer be
 * deposited under a `application/pdf`/`application/xml` label in the first place, so there is nothing
 * of the sort left for that (or any other) route reading the same store to ever mis-render.
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/** What this upload accepts — see this file's own header for why images are deliberately NOT on this
 *  list, unlike `attachments/attachments.service.ts#ALLOWED_ATTACHMENT_MIMES`. */
export const ALLOWED_RECEIVED_INVOICE_MIMES: readonly string[] = [
  'application/pdf',
  'application/xml',
  'text/xml',
];

/**
 * Same physical ceiling `attachments/attachments.service.ts#MAX_ATTACHMENT_BYTES` documents in full
 * (`main.ts`'s own global `bodyParser.json({ limit: '1mb' })`, this module's upload travelling as
 * base64 inside that SAME JSON body — see `received-invoices.service.ts`'s own header on why there is
 * no multipart/`FileInterceptor` anywhere in this backend). Duplicated here rather than imported: the
 * two allow-lists and the two callers are independent concerns that only happen to share one physical
 * constraint — see that constant's own header for the exact base64-inflation arithmetic behind the
 * figure.
 */
export const MAX_RECEIVED_INVOICE_BYTES = 750 * 1024;

const MAX_FILE_NAME_LENGTH = 255;

/**
 * How far into a PDF deposit `%PDF-` is allowed to start — never required at byte 0. ISO 32000-1
 * §7.5.2's own note is explicit that a conforming reader locates the header by SCANNING, not by
 * anchoring at the first byte, precisely because real files legitimately carry a few bytes ahead of it
 * (a stray BOM, a mail/FTP gateway's own prepended junk); this backend's own PDF library agrees in
 * practice, not just in theory — `pdf-lib`'s `PDFParser.parseHeader` (`node_modules/pdf-lib/cjs/core/
 * parser/PDFParser.js`) scans byte-by-byte with NO cap at all before giving up. 1024 is this check's
 * own, tighter defense-in-depth bound (matching the figure real-world readers converged on): generous
 * enough that a genuinely valid, spec-tolerant PDF is never rejected at the gate `extraction.ts`'s own
 * `extractEmbeddedXmlFromPdf` would still happily read, while an arbitrary non-PDF payload (an HTML
 * page, a JPEG) has no realistic chance of containing this exact five-byte sequence by coincidence
 * within it.
 */
const PDF_HEADER_SEARCH_WINDOW = 1024;

/**
 * Sniffs the ACTUAL bytes for a signature matching `mime` — never trusts the caller's own
 * Content-Type/extension alone. PDF has a fixed magic number (`%PDF-`), searched for within the first
 * `PDF_HEADER_SEARCH_WINDOW` bytes rather than anchored at byte 0 (see that constant's own header for
 * why); XML has none, so the honest bar is the same loose sniff a browser's own MIME sniffer applies to
 * `text/xml`: optional UTF-8 BOM, optional leading whitespace, then a `<`. Either way, a byte-identical
 * mismatch (an HTML page saved as `.pdf`, a JPEG renamed to `.xml`) is refused before a single byte
 * reaches disk.
 */
function bytesMatchDeclaredMime(bytes: Buffer, mime: string): boolean {
  if (mime === 'application/pdf') {
    return bytes.subarray(0, PDF_HEADER_SEARCH_WINDOW).toString('latin1').includes('%PDF-');
  }
  if (mime === 'application/xml' || mime === 'text/xml') {
    let start = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3; // UTF-8 BOM
    const head = bytes
      .subarray(start, start + 256)
      .toString('utf-8')
      .trimStart();
    return head.startsWith('<');
  }
  return false;
}

/**
 * Strips control characters and any path segment, and caps length. The filename is a THIRD PARTY's
 * own free text: `storage.ts` never uses it to build a filesystem path (the content-addressed SHA-256
 * does that job — see that file's own header), but it IS stored verbatim in `DocumentInstance.data`
 * and echoed back on download's `Content-Disposition` header, so it is sanitized as data reaching
 * storage and a future response header, not trusted as either.
 */
export function sanitizeFileName(rawFileName: string): string {
  const base = rawFileName.split(/[/\\]/).pop() || rawFileName;
  let cleaned = '';
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) cleaned += ch; // drop C0/C1 control characters and DEL
  }
  cleaned = cleaned.trim();
  if (cleaned.length === 0) cleaned = 'file';
  return cleaned.length > MAX_FILE_NAME_LENGTH ? cleaned.slice(0, MAX_FILE_NAME_LENGTH) : cleaned;
}

/**
 * Throws a NAMED exception for a disallowed mime, an oversized file, or a magic-byte mismatch —
 * called by `received-invoices.service.ts#upload` before `persistInboundFile` ever writes a byte.
 * Never called for the empty-file / exact-duplicate checks, which stay that service's own concern
 * (they need the computed hash and the existing-document lookup this module has no business knowing
 * about).
 */
export function validateInboundFile(bytes: Buffer, mime: string): void {
  if (!ALLOWED_RECEIVED_INVOICE_MIMES.includes(mime)) {
    throw new BadRequestException(
      `Unsupported file type "${mime}" — allowed: ${ALLOWED_RECEIVED_INVOICE_MIMES.join(', ')}.`,
    );
  }
  if (bytes.length > MAX_RECEIVED_INVOICE_BYTES) {
    throw new PayloadTooLargeException(
      `The uploaded file is ${bytes.length} bytes, over the ${MAX_RECEIVED_INVOICE_BYTES}-byte limit.`,
    );
  }
  if (!bytesMatchDeclaredMime(bytes, mime)) {
    throw new BadRequestException(`The uploaded file's content does not match its declared type "${mime}".`);
  }
}
