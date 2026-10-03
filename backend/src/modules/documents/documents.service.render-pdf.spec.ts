import { vi, type Mock } from 'vitest';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { hashDocumentData } from './archive/document-data-hash';
import * as archivePersistence from './archive/persistence';
import { ContributionRegistry } from './contributions/contribution-registry';
import {
  asciiContentDispositionFallback,
  buildOriginalContentDisposition,
  DocumentsService,
  rfc5987Encode,
  safeOriginalMime,
} from './documents.service';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as renderInstancePdf from './rendering/render-instance-pdf';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./persistence');
vi.mock('./rendering/render-instance-pdf');
vi.mock('./archive/persistence');

/**
 * `DocumentsService.renderInstancePdf` — the ONE method every PDF route in this backend funnels
 * through: the authenticated `GET :id/pdf` (documents.controller.ts), the public share-link download
 * (public-documents.controller.ts), and the client portal's own document download
 * (client-portal/portal.service.ts#getDocumentPdf) — see that method's own header. Every API replica
 * otherwise launches and holds its own Chromium purely to answer these routes, three of which are
 * unauthenticated.
 *
 * This proves the fix directly: a document that already has an archived PDF is served THOSE bytes,
 * with `renderDocumentInstance` (the Chromium-backed composition — `rendering/render-pdf.spec.ts`
 * covers that layer on its own) never even called; a document with nothing archived yet (a draft) or
 * delivered through a channel with no plain-PDF artifact still falls through to the render this
 * method has always done. `archive/persistence.ts#findArchivedPdfArtifact` itself is proven against a
 * REAL disk round trip in `archive/persistence.spec.ts` — mocked here at its own module boundary,
 * exactly like `./persistence` and `./rendering/render-instance-pdf` already are, so this file stays
 * about the ONE decision `renderInstancePdf` itself makes (archive first, render only if absent).
 */
function buildService(): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

const SENT_QUOTE = {
  id: 'doc-1',
  typeId: 'quote',
  status: 'sent',
  data: { client: 'client-1' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DocumentsService.renderInstancePdf — serving the archive instead of re-rendering', () => {
  beforeEach(() => vi.resetAllMocks());

  it('serves the archived PDF byte-for-byte, and NEVER calls renderDocumentInstance, when one exists', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_QUOTE);
    const archivedBytes = Buffer.from('%PDF-1.7 already archived — exactly what was emailed');
    (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(archivedBytes);

    const service = buildService();
    const pdf = await service.renderInstancePdf('company-1', 'quote', 'doc-1');

    // The EXACT same object, not a copy re-derived from it — the strongest form of "the bytes are
    // the same" a unit test can assert.
    expect(pdf).toBe(archivedBytes);
    expect(archivePersistence.findArchivedPdfArtifact).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      expect.any(Function),
    );
    expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
  });

  it('falls back to rendering fresh (and signing if configured) when nothing is archived yet', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({ ...SENT_QUOTE, status: 'draft' });
    (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(null);
    const rendered = Buffer.from('%PDF-1.7 freshly rendered');
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({ pdf: rendered });

    const service = buildService();
    const pdf = await service.renderInstancePdf('company-1', 'quote', 'doc-1');

    // No active signing certificate configured in this fixture (no CREDENTIALS_ENCRYPTION_KEY) — the
    // rendered buffer passes through `signRenderedPdfIfConfigured` untouched, the same invariant every
    // pre-existing `documents.service.*.spec.ts` already relies on.
    expect(pdf).toEqual(rendered);
    expect(renderInstancePdf.renderDocumentInstance).toHaveBeenCalledTimes(1);
  });

  it('checks the archive scoped to the exact (companyId, documentId) this call was made for, before ever reading the instance for rendering', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_QUOTE);
    (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(null);
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({ pdf: Buffer.from('x') });

    const service = buildService();
    await service.renderInstancePdf('company-9', 'quote', 'doc-42');

    expect(archivePersistence.findArchivedPdfArtifact).toHaveBeenCalledWith(
      'company-9',
      'doc-42',
      expect.any(Function),
    );
  });

  // Issue #490: the predicate this method hands `findArchivedPdfArtifact` is what keeps a stale
  // archive from being served. Proven end to end against real Postgres and real storage in
  // `documents.service.render-pdf-currency.spec.ts`; here, only that it is wired to the instance
  // this call read and to the type's own issued statuses.
  describe('the archive predicate (issue #490)', () => {
    async function predicateFor(instance: typeof SENT_QUOTE) {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(instance);
      (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(null);
      (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({ pdf: Buffer.from('x') });
      await buildService().renderInstancePdf('company-1', 'quote', 'doc-1');
      return (archivePersistence.findArchivedPdfArtifact as Mock).mock.calls[0][2] as (
        hash: string | null,
      ) => boolean;
    }

    it('accepts an archive rendered from the current data, refuses one rendered from other data or of unknown data', async () => {
      const isServable = await predicateFor(SENT_QUOTE);
      expect(isServable(hashDocumentData(SENT_QUOTE.data))).toBe(true);
      expect(isServable(hashDocumentData({ client: 'client-2' }))).toBe(false);
      expect(isServable(null)).toBe(false);
    });

    it('accepts any archive of a quote in an issued status ("signed")', async () => {
      const isServable = await predicateFor({ ...SENT_QUOTE, status: 'signed' });
      expect(isServable(hashDocumentData({ client: 'client-2' }))).toBe(true);
      expect(isServable(null)).toBe(true);
    });
  });

  // Issue #340: an "imported" document is issued too (`archived-pdf-policy.spec.ts` proves
  // `issuedStatusesOf` says so), but it can never carry a DELIVERY archive - it was never sent BY THIS
  // APPLICATION - so its legal copy is the IMPORT_ORIGINAL archive instead, resolved BEFORE
  // `findArchivedPdfArtifact`/`isArchivedPdfServable` ever run. This is the fix for the exact defect a
  // real CI run caught: without it, an imported document fell through to a FRESH Chromium render of
  // whatever `data` the import stored, served as if it were the issued copy it is not.
  describe('"imported" documents (issue #340) - the IMPORT_ORIGINAL archive, never a fresh render', () => {
    const IMPORTED_INVOICE = {
      id: 'doc-imported-1',
      typeId: 'invoice',
      status: 'imported',
      data: { client: 'client-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('serves the archived original byte-for-byte when it is already a PDF, and never renders or consults the DELIVERY archive', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
      const originalBytes = Buffer.from('%PDF-1.4 the previous tool own original invoice');
      (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue({
        bytes: originalBytes,
        mime: 'application/pdf',
      });

      const service = buildService();
      const pdf = await service.renderInstancePdf('company-1', 'invoice', 'doc-imported-1');

      expect(pdf).toBe(originalBytes);
      expect(archivePersistence.findImportOriginalArtifact).toHaveBeenCalledWith(
        'company-1',
        'doc-imported-1',
      );
      expect(archivePersistence.findArchivedPdfArtifact).not.toHaveBeenCalled();
      expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
    });

    it('refuses (409) rather than render fresh when the archived original is not a PDF (a structured XML the previous tool issued)', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
      (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue({
        bytes: Buffer.from('<Invoice>fake KSeF FA(3) xml</Invoice>'),
        mime: 'application/xml',
      });

      const service = buildService();
      await expect(service.renderInstancePdf('company-1', 'invoice', 'doc-imported-1')).rejects.toThrow(
        /not a PDF/,
      );
      expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
    });

    it('refuses (409) rather than render fresh when the document has no IMPORT_ORIGINAL archive at all', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
      (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue(null);

      const service = buildService();
      await expect(service.renderInstancePdf('company-1', 'invoice', 'doc-imported-1')).rejects.toThrow(
        /no archived original/,
      );
      expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
    });
  });
});

/**
 * Issue #549 - `DocumentsService.downloadImportOriginal`, the route `renderInstancePdf` above points
 * users at when an imported document's original is not a PDF: serves the SAME `IMPORT_ORIGINAL`
 * archive's bytes, but for ANY mime, never refusing on the syntax alone the way `GET .../pdf` does.
 */
describe('DocumentsService.downloadImportOriginal - the archived original, for any mime', () => {
  beforeEach(() => vi.resetAllMocks());

  const IMPORTED_INVOICE = {
    id: 'doc-imported-1',
    typeId: 'invoice',
    status: 'imported',
    displayNumber: 'FV/2024/01',
    data: { client: 'client-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('serves the archived original byte-for-byte with its own mime and a filename built from the display number, for a structured XML original', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
    const originalBytes = Buffer.from('<Invoice>fake KSeF FA(3) xml</Invoice>');
    (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue({
      bytes: originalBytes,
      mime: 'application/xml',
    });

    const service = buildService();
    const result = await service.downloadImportOriginal('company-1', 'invoice', 'doc-imported-1');

    expect(result.bytes).toBe(originalBytes);
    expect(result.mime).toBe('application/xml');
    expect(result.filename).toBe('FV/2024/01-original.xml');
    expect(archivePersistence.findImportOriginalArtifact).toHaveBeenCalledWith('company-1', 'doc-imported-1');
  });

  it('serves an image original with the right extension', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
    const originalBytes = Buffer.from('fake jpeg bytes');
    (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue({
      bytes: originalBytes,
      mime: 'image/jpeg',
    });

    const service = buildService();
    const result = await service.downloadImportOriginal('company-1', 'invoice', 'doc-imported-1');

    expect(result.mime).toBe('image/jpeg');
    expect(result.filename).toBe('FV/2024/01-original.jpg');
  });

  it('falls back to application/octet-stream (never the stored mime verbatim) for a mime outside the import allow-list', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
    (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue({
      bytes: Buffer.from('whatever this row actually holds'),
      // Never accepted by the import path (attachments.service.ts#ALLOWED_ATTACHMENT_MIMES) - stands
      // in for a stale/tampered archive row, which must never be served with a browser-renderable
      // mime such as text/html.
      mime: 'text/html',
    });

    const service = buildService();
    const result = await service.downloadImportOriginal('company-1', 'invoice', 'doc-imported-1');

    expect(result.mime).toBe('application/octet-stream');
    expect(result.filename).toBe('FV/2024/01-original.bin');
  });

  it('refuses (409) for a document that was never imported', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({ ...IMPORTED_INVOICE, status: 'sent' });

    const service = buildService();
    await expect(service.downloadImportOriginal('company-1', 'invoice', 'doc-imported-1')).rejects.toThrow(
      /never imported/,
    );
    expect(archivePersistence.findImportOriginalArtifact).not.toHaveBeenCalled();
  });

  it('refuses (409) when the imported document has no archived original on file', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(IMPORTED_INVOICE);
    (archivePersistence.findImportOriginalArtifact as Mock).mockResolvedValue(null);

    const service = buildService();
    await expect(service.downloadImportOriginal('company-1', 'invoice', 'doc-imported-1')).rejects.toThrow(
      /no archived original/,
    );
  });
});

/**
 * Issue #549 code review - `filename` fed into `Content-Disposition` is built from
 * `instance.displayNumber`, the PREVIOUS TOOL's own number, entered verbatim (#340's own decision:
 * never reformatted, never validated against a charset). That makes it as untrusted as any other
 * user input: a quote or backslash could break out of the `filename="..."` quoted string, CR/LF
 * could inject a second header line, and non-ASCII would be mangled by everything downstream of a
 * naive ASCII-only header anyway. These prove the header this repo actually sends is safe AND still
 * carries the real name for a client that understands `filename*` (RFC 6266/5987).
 */
describe('Content-Disposition safety for a user-controlled original file name (issue #549)', () => {
  // The exact shape the review asked for: a double quote, a literal newline, and an accented
  // character, all in the SAME value - a previous tool's own number is free-form text, so nothing
  // stops a real one from containing any of these.
  const HOSTILE_NUMBER = 'INV"2024\n/Été-001';

  it('the ASCII fallback carries no quote, no backslash and no control character (including CR/LF)', () => {
    const fallback = asciiContentDispositionFallback(`${HOSTILE_NUMBER}-original.xml`);

    expect(fallback).not.toMatch(/["\\]/);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the assertion IS that none survive.
    expect(fallback).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(fallback).toBe('INV_2024_/_t_-001-original.xml');
  });

  it('the RFC 5987 filename* form percent-encodes the quote, the newline and the accented character', () => {
    const encoded = rfc5987Encode(`${HOSTILE_NUMBER}.xml`);

    // Never a raw quote/backslash/newline in the header value itself.
    expect(encoded).not.toMatch(/["\\\n\r]/);
    // The accented "é" (U+00E9) is 2 UTF-8 bytes (0xC3 0xA9) - both percent-encoded, never passed
    // through as a raw non-ASCII byte a header must not carry.
    expect(encoded).toContain('%C3%A9');
    expect(encoded).toContain('%22'); // "
    expect(encoded).toContain('%0A'); // \n
    // A real client decodes this back to the ORIGINAL value - the whole point of shipping it
    // alongside the ASCII fallback rather than only a mangled name.
    expect(decodeURIComponent(encoded)).toBe(`${HOSTILE_NUMBER}.xml`);
  });

  it('the full header carries both forms, and the quoted ASCII fallback is a syntactically valid quoted-string', () => {
    const header = buildOriginalContentDisposition(`${HOSTILE_NUMBER}-original.xml`);

    expect(header).toMatch(/^attachment; filename="[^"\\]*"; filename\*=UTF-8''.+$/);
    expect(header).not.toMatch(/[\r\n]/);
    // "É" (U+00C9, UTF-8 0xC3 0x89) and "é" (U+00E9, UTF-8 0xC3 0xA9) encode to DIFFERENT byte
    // pairs - proving this is a real byte-level encode, not a case-insensitive lookup.
    expect(header).toContain("filename*=UTF-8''INV%222024%0A%2F%C3%89t%C3%A9-001-original.xml");
  });

  it('an ordinary, already-safe number is left untouched by the ASCII fallback', () => {
    expect(asciiContentDispositionFallback('OLD-2024-0142-original.xml')).toBe('OLD-2024-0142-original.xml');
  });
});

describe('safeOriginalMime (issue #549)', () => {
  it('passes through every mime the import path itself accepts', () => {
    for (const mime of [
      'application/pdf',
      'application/xml',
      'text/xml',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]) {
      expect(safeOriginalMime(mime)).toBe(mime);
    }
  });

  it('falls back to application/octet-stream for anything else, including a browser-renderable mime', () => {
    expect(safeOriginalMime('text/html')).toBe('application/octet-stream');
    expect(safeOriginalMime('image/svg+xml')).toBe('application/octet-stream');
    expect(safeOriginalMime('')).toBe('application/octet-stream');
  });
});
