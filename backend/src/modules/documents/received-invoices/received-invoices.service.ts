/**
 * "Received invoices" — the ONE bespoke service this type needs beyond the
 * generic document machinery: uploading a file is not "persist this type's own declared fields"
 * (`actions/received-invoice-actions.ts`'s "receive" already covers that), it is a SEPARATE
 * operation — store bytes, hash them, refuse an exact repeat, best-effort extract — that has no
 * document instance to act on yet. Controller -> Service -> Prisma, same as everywhere else in this
 * module; `DocumentInstance` reads/writes go through `persistence.ts`'s tenant-scoped helpers, as
 * everywhere else in this module. Supplier reconciliation adds ONE further Prisma-touching step —
 * `supplier-reconciliation.ts`'s own `reconcileSupplierClient`, reaching `Client`/`PartyIdentifier`
 * directly (never through `ClientsService` — see that file's own header for why) — because matching a
 * supplier is not a `DocumentInstance` concern `persistence.ts` has any business knowing about.
 * The OCR fallback adds ONE further step, ONLY for a PDF structural extraction found nothing
 * in: `ocr/apply-ocr-fallback.ts` — this service never imports a cloud provider, only that pure
 * orchestration function and the fields it hands back (see `ocr/extractor.ts`'s own header for the
 * full "core has no cloud dependency" reasoning).
 *
 * OCR itself is either run SYNCHRONOUSLY, inside this request, or handed off to the dedicated
 * `received-invoice-ocr` BullMQ queue (`ocr/ocr-queue.constants.ts`) and returned as
 * `ocr: { outcome: 'pending' }` — see `upload()`'s own comment for exactly which. Moved off the
 * request entirely because Tesseract, run synchronously through the OCR container, could make the
 * browser wait up to the frontend's own 60s upload timeout under real load — a request timing out
 * while the file WAS actually stored, with nothing left for the upload dialog to show for it.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { computeArtifactHash } from '../archive/hashing';
import { findOwnedDocument, listAllDocuments } from '../persistence';
import {
  ReceivedInvoiceOcrDispatcher,
  ReceivedInvoiceOcrResult,
} from '../queue/received-invoice-ocr.dispatcher';
import { ExtractionResult, extractReceivedInvoiceFields } from './extraction';
import { applyOcrFallback, needsOcr, OcrOutcome } from './ocr/apply-ocr-fallback';
import { receivedDocumentExtractorRegistry } from './ocr/extractor';
import { persistInboundFile, readInboundFile } from './storage';
import { reconcileSupplierClient, SupplierMatchResult } from './supplier-reconciliation';
import { sanitizeFileName, validateInboundFile } from './upload-validation';

const TYPE_ID = 'received-invoice';

/** The one mime `ocr/extractor.ts`'s registered providers ever declare `supports()` for — see
 *  `apply-ocr-fallback.ts`'s own `applyOcrFallback` for why a generic/wrong upload mime on an
 *  otherwise-clearly-`.pdf` file must not defeat resolution; this gate deliberately checks the SAME
 *  normalized mime that function would end up resolving against, never `input.mime` verbatim. */
const PDF_MIME = 'application/pdf';

export interface UploadReceivedInvoiceInput {
  fileName: string;
  mime: string;
  /** Raw file bytes, already read into memory by multer's `memoryStorage()` at
   *  `received-invoices.controller.ts#upload` — see `upload-validation.ts`'s own
   *  `MAX_RECEIVED_INVOICE_BYTES` header for why this is no longer base64-in-JSON. */
  bytes: Buffer;
}

export interface UploadReceivedInvoicePreview {
  /** The uploaded file's own SHA-256 (hex) — ALSO the content-address key (`storage.ts`) and the
   *  duplicate-detection key. Not persisted as a `DocumentInstance` by this call: see this file's own
   *  header — the caller (the frontend's upload dialog) seeds this into a NEW record's `data.fileRef`
   *  only once the user actually confirms via the "receive" action. */
  fileRef: string;
  fileName: string;
  mime: string;
  extraction: {
    /** null when nothing recognizable was found — see extraction.ts's own header. Never a refusal:
     *  the file is stored and returned regardless (see `extractionOk` below). */
    syntax: string | null;
    fields: Record<string, unknown>;
  };
  /**
   * The OUTCOME of auto-reconciliation "at upload", computed from whatever the
   * `extraction` above just read (`supplierVatId`/`supplier`) — see `supplier-reconciliation.ts`'s own
   * header for the exact rule (VAT first, exact name fallback, ambiguity never silently resolved,
   * NEVER a created client). Surfaced separately from `extraction.fields` so the upload dialog can
   * tell the user apart from a silent pre-fill: `outcome: 'matched'` means `extraction.fields` above
   * ALSO carries a `supplierClient` id (the same generic pre-fill mechanism every other extracted
   * field already uses — `custom/received-invoice-upload-button.tsx`'s own `buildInitialData`);
   * anything else means it does not, and the screen says so.
   */
  supplierMatch: SupplierMatchResult;
  /**
   * The OCR fallback's own outcome (`ocr/apply-ocr-fallback.ts`), tried ONLY
   * when this deposit was a PDF and structural extraction (above) found nothing at all. Surfaced
   * separately from `extraction`/`supplierMatch` for the SAME reason `supplierMatch` already is
   * (see that field's own comment): the upload dialog must be able to tell "OCR extracted this" or
   * "no OCR available, fill in by hand" or "the OCR provider errored" apart from a merely-empty
   * `extraction.fields` — never a silent, unexplained blank form.
   *
   * A FIFTH outcome, `{ outcome: 'pending' }`, means OCR was handed off to the dedicated
   * `received-invoice-ocr` queue instead of running inside this request — `extraction`/`supplierMatch`
   * above are then computed from empty fields (nothing has been read yet), and the frontend polls
   * `GET /documents/received-invoices/upload/:fileRef/ocr` for the real outcome. See `upload()`'s own
   * comment for exactly when this happens.
   */
  ocr: OcrOutcome;
}

@Injectable()
export class ReceivedInvoicesService {
  constructor(private readonly ocrDispatcher: ReceivedInvoiceOcrDispatcher) {}

  /**
   * Stores the uploaded file content-addressed, refuses an EXACT repeat (same company, same
   * SHA-256, already the `fileRef` of an EXISTING received-invoice record) by name, and returns a
   * best-effort extraction PREVIEW — never a persisted `DocumentInstance`. See
   * received-invoice.descriptor.ts's own header ("extraction impossible ... never a refusal") for why
   * a recognized-but-empty extraction is not an error at all, only a genuine duplicate hash is.
   */
  async upload(companyId: string, input: UploadReceivedInvoiceInput): Promise<UploadReceivedInvoicePreview> {
    const bytes = input.bytes;
    if (bytes.length === 0) {
      throw new ConflictException('The uploaded file is empty.');
    }
    // Mime allow-list, size ceiling, and a magic-byte check against the ACTUAL bytes — never trusts
    // the caller's own declared mime/extension alone. See `upload-validation.ts`'s own header for why
    // the allow-list is narrower than `attachments/attachments.service.ts`'s (no images: nothing
    // downstream of THIS upload — `extraction.ts`, the OCR extension point — ever reads one) and why
    // this runs before a single byte reaches disk.
    validateInboundFile(bytes, input.mime);
    const fileName = sanitizeFileName(input.fileName);
    const fileRef = computeArtifactHash(bytes);

    // The hash goes into the QUERY, so the whole inbox is checked however large it is. This used to
    // scan the 500 most recently touched received invoices and compare `fileRef` in memory: past
    // that, re-uploading a file already on record was accepted as new — the same supplier invoice
    // recorded twice, and eventually paid twice, with the duplicate check reporting nothing at all.
    const [duplicate] = await listAllDocuments(companyId, {
      typeId: TYPE_ID,
      dataEquals: { fileRef },
    });
    if (duplicate) {
      throw new ConflictException(
        `This exact file has already been received (document "${duplicate.id}", ` +
          `SHA-256 ${fileRef}) — re-uploading the same bytes is refused as a duplicate.`,
      );
    }

    await persistInboundFile(companyId, fileRef, input.mime, bytes);

    const structural = await extractReceivedInvoiceFields(bytes, input.mime, fileName);

    // Asynchronous OCR — see this file's own header for why. Enqueued instead of run inline ONLY when
    // ALL THREE hold: `needsOcr` (a PDF with nothing structural — the exact condition
    // `applyOcrFallback` itself uses), a real extractor is registered for PDFs, AND that extractor
    // reports itself configured (`isConfigured?.() !== false` — an ABSENT method, or one returning
    // `true`, both mean "assume it's worth trying"; see `ocr/extractor.ts`'s own header on that
    // contract). A self-hosted instance with NO extractor configured at all (`OCR_SERVICE_URL` unset)
    // fails this gate on the third condition and falls straight through to the exact same synchronous
    // path this method has always run — `LocalOcrProvider.isConfigured()` returns `false`, so nothing
    // about this change alters that instance's behavior even by one HTTP round trip.
    if (this.shouldEnqueueOcr(structural, input.mime, fileName)) {
      await this.ocrDispatcher.enqueue({ companyId, fileRef, fileName, mime: input.mime });
      // Computed from EMPTY fields, exactly the way `reconcileSupplierClient` is called a few lines
      // below for the synchronous path — nothing has been read yet, so this can only ever land on
      // `{ outcome: 'unmatched', reason: 'no-criteria' }`, resolved synchronously (no criteria means
      // neither branch inside it ever reaches Prisma).
      const supplierMatch = await reconcileSupplierClient(companyId, {});
      return {
        fileRef,
        fileName,
        mime: input.mime,
        extraction: { syntax: null, fields: {} },
        supplierMatch,
        ocr: { outcome: 'pending' },
      };
    }

    // OCR fallback — tried ONLY when `structural` found nothing at all AND this deposit is
    // a PDF (see that function's own header): a working CII/UBL/Factur-X read is never
    // second-guessed by OCR, and OCR is never attempted for anything but a PDF. Reached here either
    // because `needsOcr` is false (nothing to try) or because no configured extractor exists — the
    // gate above already ruled out every case an extractor would actually be CALLED asynchronously.
    const {
      syntax,
      fields: extractedFields,
      ocr,
    } = await applyOcrFallback(structural, bytes, input.mime, fileName);

    // Supplier reconciliation "at upload": the ONLY point this runs. `data.supplierClient` (a
    // 'reference' field, see received-invoice.descriptor.ts) is filled in HERE, exactly like every
    // other extracted field, then simply flows through the ordinary create form — "receive" never
    // re-runs this (see that action's own header on why). Reads `extractedFields`, NOT `structural.
    // fields` — an OCR-read supplier VAT/name is exactly as eligible for auto-reconciliation as a
    // structurally-read one (see `ocr/extractor.ts`'s own header: the proposal shape is IDENTICAL).
    const supplierMatch = await reconcileSupplierClient(companyId, {
      vatId: extractedFields.supplierVatId,
      supplierName: extractedFields.supplier,
    });
    const fields: Record<string, unknown> = { ...extractedFields };
    if (supplierMatch.outcome === 'matched') {
      fields.supplierClient = supplierMatch.clientId;
    }

    return {
      fileRef,
      fileName,
      mime: input.mime,
      extraction: { syntax, fields },
      supplierMatch,
      ocr,
    };
  }

  /** The enqueue gate `upload()` above calls — see that call site's own comment for the exact
   *  three-part rule. Pulled into its own method purely so that comment can name it once, at the call
   *  site, rather than reading as a single long `if` condition. */
  private shouldEnqueueOcr(structural: ExtractionResult, mime: string, fileName: string): boolean {
    if (!needsOcr(structural, mime, fileName)) return false;
    const extractor = receivedDocumentExtractorRegistry.resolveFor(PDF_MIME);
    if (!extractor) return false;
    return extractor.isConfigured?.() !== false;
  }

  /**
   * GET .../upload/:fileRef/ocr — the pending-OCR poll `upload()` sends the frontend off to do when it
   * returns `ocr: { outcome: 'pending' }`. Delegates straight to `ReceivedInvoiceOcrDispatcher.getResult`
   * (`queue/received-invoice-ocr.dispatcher.ts`) — see that method's own header for the pending/done/
   * failed/404 shape. Tenant isolation is structural, not a query filter here: the dispatcher's own job
   * id embeds `companyId` (never derived from anything this method itself reads), so there is nothing
   * for this method to additionally scope.
   */
  async getOcrStatus(companyId: string, fileRef: string): Promise<ReceivedInvoiceOcrResult | null> {
    return this.ocrDispatcher.getResult(companyId, fileRef);
  }

  /** Streams back the ORIGINAL uploaded bytes for an already-saved received-invoice — 404s via
   *  `findOwnedDocument` the same tenant-scoped way every other single-document operation in this
   *  module does, before this ever touches the filesystem. A record whose `data.fileRef` somehow
   *  does not resolve to a file still on disk 404s too, named distinctly — never a raw 500. */
  async downloadFile(
    companyId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; fileName: string; mime: string }> {
    const document = await findOwnedDocument(companyId, TYPE_ID, documentId);
    const data = (document.data ?? {}) as Record<string, unknown>;
    const fileRef = typeof data.fileRef === 'string' ? data.fileRef : undefined;
    const mime = typeof data.fileMime === 'string' ? data.fileMime : 'application/octet-stream';
    const fileName = typeof data.fileName === 'string' ? data.fileName : `${documentId}`;

    if (!fileRef) {
      throw new NotFoundException(`Document "${documentId}" has no original file attached.`);
    }

    const bytes = await readInboundFile(companyId, fileRef, mime);
    if (!bytes) {
      throw new NotFoundException(
        `Document "${documentId}" references a file (SHA-256 ${fileRef}) that is no longer on disk.`,
      );
    }

    return { bytes, fileName, mime };
  }
}
