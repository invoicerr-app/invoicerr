/**
 * `upload-validation.ts`'s own pure functions, proven in isolation — `received-invoices.service.spec.ts`
 * already proves the WIRING (this module is actually called before a byte reaches disk); this file
 * proves the RULES themselves, including the two edge cases a purely wiring-level test would never
 * surface: a genuinely spec-tolerant PDF that does not start at byte 0, and a BOM-prefixed XML deposit.
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import { MAX_RECEIVED_INVOICE_BYTES, sanitizeFileName, validateInboundFile } from './upload-validation';

function pdfBytes(prefix = ''): Buffer {
  return Buffer.from(`${prefix}%PDF-1.4\n%comment\n1 0 obj\n<< >>\nendobj`, 'latin1');
}

describe('validateInboundFile', () => {
  it('accepts a genuine PDF deposit', () => {
    expect(() => validateInboundFile(pdfBytes(), 'application/pdf')).not.toThrow();
  });

  it('accepts a genuine XML deposit', () => {
    expect(() => validateInboundFile(Buffer.from('<Invoice/>', 'utf-8'), 'application/xml')).not.toThrow();
  });

  it('accepts an XML deposit prefixed by a UTF-8 BOM', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<Invoice/>', 'utf-8')]);
    expect(() => validateInboundFile(withBom, 'text/xml')).not.toThrow();
  });

  it('accepts an XML deposit with leading whitespace before the first tag', () => {
    const withLeadingSpace = Buffer.from('\n\n  <Invoice/>', 'utf-8');
    expect(() => validateInboundFile(withLeadingSpace, 'application/xml')).not.toThrow();
  });

  // ISO 32000-1 §7.5.2's own note: a conforming reader SCANS for `%PDF-`, it does not require it at
  // byte 0 — real files legitimately carry a few bytes ahead of it (a stray BOM, a mail/FTP gateway's
  // own prepended junk). `pdf-lib` (this backend's own PDF library, used right after this check by
  // `extraction.ts#extractEmbeddedXmlFromPdf`) agrees in practice: its `PDFParser.parseHeader` scans
  // for the header with no byte-0 requirement at all. Rejecting this at the upload gate would refuse a
  // file the rest of this backend can read perfectly well.
  it('accepts a PDF whose header is preceded by a few bytes of leading junk, per the PDF spec', () => {
    const leadingJunk = Buffer.from([0x00, 0x01, 0x02, 0x20, 0x20]);
    expect(() =>
      validateInboundFile(Buffer.concat([leadingJunk, pdfBytes()]), 'application/pdf'),
    ).not.toThrow();
  });

  it('refuses a PDF whose header sits past the search window — not a real-world PDF shape', () => {
    const farJunk = Buffer.alloc(2048, 0x20);
    expect(() => validateInboundFile(Buffer.concat([farJunk, pdfBytes()]), 'application/pdf')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a mime outside the allow-list', () => {
    expect(() => validateInboundFile(Buffer.from('anything'), 'image/png')).toThrow(BadRequestException);
  });

  it('refuses declared PDF bytes that are not actually a PDF', () => {
    expect(() =>
      validateInboundFile(Buffer.from('<html>not a pdf</html>', 'utf-8'), 'application/pdf'),
    ).toThrow(BadRequestException);
  });

  it('refuses declared XML bytes that are not actually XML', () => {
    expect(() => validateInboundFile(pdfBytes(), 'application/xml')).toThrow(BadRequestException);
  });

  it('refuses a file over the byte ceiling, named', () => {
    const oversized = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_RECEIVED_INVOICE_BYTES, 0x20)]);
    expect(() => validateInboundFile(oversized, 'application/pdf')).toThrow(PayloadTooLargeException);
  });

  it('accepts a file exactly at the byte ceiling', () => {
    const exact = Buffer.concat([
      pdfBytes(),
      Buffer.alloc(MAX_RECEIVED_INVOICE_BYTES - pdfBytes().length, 0x20),
    ]);
    expect(exact.length).toBe(MAX_RECEIVED_INVOICE_BYTES);
    expect(() => validateInboundFile(exact, 'application/pdf')).not.toThrow();
  });
});

describe('sanitizeFileName', () => {
  it('strips a POSIX path down to its basename', () => {
    expect(sanitizeFileName('../../etc/passwd.xml')).toBe('passwd.xml');
  });

  it('strips a Windows-style path down to its basename', () => {
    expect(sanitizeFileName('C:\\Users\\evil\\..\\..\\invoice.pdf')).toBe('invoice.pdf');
  });

  it('drops C0 control characters (including NUL) and DEL', () => {
    expect(sanitizeFileName('invoice\u0000\u0007.xml\u007f')).toBe('invoice.xml');
  });

  it('trims surrounding whitespace left after stripping', () => {
    expect(sanitizeFileName('  invoice.pdf  ')).toBe('invoice.pdf');
  });

  it('falls back to a fixed name when nothing printable survives', () => {
    expect(sanitizeFileName('\u0000\u0000\u0000')).toBe('file');
  });

  it('caps an absurdly long filename at 255 characters', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const result = sanitizeFileName(long);
    expect(result.length).toBe(255);
  });
});
