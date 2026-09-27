/**
 * The received-invoice OCR job's own body — a plain, exported function, deliberately NOT a method on
 * `ReceivedInvoiceOcrProcessor` (`queue/processors/received-invoice-ocr.processor.ts`): the processor
 * is a thin `@Processor()`/`WorkerHost` shim (Nest, BullMQ, a `Job` object), this function is the
 * actual logic, unit-testable with no Nest application and no Redis — the same split
 * `document-action-job.ts` already holds for the document-action queue's own job shape.
 *
 * The job's data (`ReceivedInvoiceOcrJobData`, `ocr-queue.constants.ts`) NEVER carries the file's own
 * bytes — Redis is not file storage, and a scanned PDF can be several MB. This function re-reads them
 * itself, by `(companyId, fileRef, mime)`, from the exact same content-addressed store
 * `received-invoices.service.ts#upload` already wrote them into (`../storage.ts`).
 *
 * Runs `applyOcrFallback` exactly the way the SYNCHRONOUS upload path used to (before this job
 * existed) — same structural input (`{ syntax: null, fields: {} }`: this job is only ever enqueued for
 * a PDF that already had nothing structural, see `apply-ocr-fallback.ts#needsOcr`'s own header) — then
 * the SAME supplier-reconciliation step `upload()` still runs today for the synchronous path, so an
 * OCR-sourced supplier VAT/name is exactly as eligible for auto-reconciliation whether it was read
 * inside the request or, now, inside this job.
 *
 * Step 4, BACKFILL, is the one behavior with no synchronous equivalent: by the time this job finishes,
 * the user may already have confirmed the "receive" action from the upload's own (empty) preview,
 * without waiting for OCR — `backfillReceivedInvoice` below fills in whatever THAT record is still
 * missing, never overwriting a field the human already typed (see its own header for the exact rule).
 */
import { ConflictException } from '@nestjs/common';

import { DocumentEventPublisher } from '../../queue/document-events';
import { listAllDocuments, upsertDocument } from '../../persistence';
import { applyOcrFallback, OcrOutcome } from './apply-ocr-fallback';
import { readInboundFile } from '../storage';
import { reconcileSupplierClient, SupplierMatchResult } from '../supplier-reconciliation';

const TYPE_ID = 'received-invoice';

/** Thrown when this job's own file is no longer on disk/in the bucket — the ONE way this function
 *  throws at all (`applyOcrFallback` never does — see that function's own header). A genuinely
 *  named error rather than a bare `Error`, so `ReceivedInvoiceOcrDispatcher.getResult`'s own "failed"
 *  branch (`queue/received-invoice-ocr.dispatcher.ts`) has something more specific than a string to
 *  point a future caller at, even though today it only ever reads `job.failedReason` (the message). */
export class ReceivedInvoiceFileMissingError extends Error {
  constructor(companyId: string, fileRef: string) {
    super(
      `Received-invoice file (company ${companyId}, fileRef ${fileRef}) is no longer on disk/in the ` +
        'bucket — cannot run OCR on bytes that are not there any more.',
    );
    this.name = 'ReceivedInvoiceFileMissingError';
  }
}

export interface RunReceivedInvoiceOcrJobInput {
  companyId: string;
  fileRef: string;
  fileName: string;
  mime: string;
  /** Optional — a spec calling this function directly never needs a real publisher (`publish` is only
   *  ever called AFTER a backfill write genuinely happens), and `DocumentEventsPublisher.publish`
   *  itself already never throws (see that class's own header) — a missed nudge here is exactly as
   *  harmless as everywhere else in this codebase that publisher is optional: the frontend's own ~60s
   *  polling fallback still catches it. */
  events?: DocumentEventPublisher;
}

export interface RunReceivedInvoiceOcrJobResult {
  extraction: { syntax: string | null; fields: Record<string, unknown> };
  supplierMatch: SupplierMatchResult;
  ocr: OcrOutcome;
}

/** `undefined`/`null`/`''`/an empty array — the ONLY values `backfillReceivedInvoice` below treats as
 *  "nothing here yet, safe to fill". Anything else — `0`, `false`, a non-empty string the human typed,
 *  a non-empty array — is a REAL value already, and is never touched. */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * Fills in whatever a `received-invoice` document, already saved BEFORE this OCR job finished, is
 * still missing — never overwrites a key the human already gave a real value, whether that value came
 * from the user's own typing or from structural extraction at upload time (this job is only ever
 * enqueued when structural extraction found nothing at all, but the human may have edited the form
 * before saving regardless). `fields` here is the SAME merged `extraction.fields`
 * `runReceivedInvoiceOcrJob` below is about to return — including `supplierClient` when
 * `reconcileSupplierClient` matched, exactly like the synchronous upload path already folds it in.
 *
 * No record found (the user has not confirmed "receive" yet, or confirmed it with a DIFFERENT file
 * entirely — vanishingly unlikely given `fileRef` is a content hash, but not impossible if the upload
 * preview was simply abandoned) means there is nothing to backfill: this is the ORDINARY case for a
 * fast OCR job racing a slow human, not an error.
 *
 * Guarded by the same-value compare-and-swap `persistence.ts#claimDocumentTransition`'s own header
 * documents, for the identical reason: reading `existing.status` and writing it back as BOTH the
 * new status AND the sole entry of `fromStatuses` still catches a genuinely concurrent status change
 * (an "approve"/"reject"/edit landing between this function's own read and write) — that write is
 * refused with a `ConflictException`, which this function treats as "the human's own concurrent action
 * wins", not a job failure.
 */
async function backfillReceivedInvoice(
  companyId: string,
  fileRef: string,
  fields: Record<string, unknown>,
  events: DocumentEventPublisher | undefined,
): Promise<void> {
  const [existing] = await listAllDocuments(companyId, { typeId: TYPE_ID, dataEquals: { fileRef } });
  if (!existing) return;

  const currentData = (existing.data ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isEmptyValue(currentData[key])) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return;

  const mergedData = { ...currentData, ...patch };
  try {
    await upsertDocument(companyId, TYPE_ID, existing.id, existing.status, mergedData, [existing.status]);
  } catch (err) {
    if (err instanceof ConflictException) return;
    throw err;
  }

  // A NEW kind (`document-events.ts`), distinct from the async-send trio and from `authority-event`:
  // none of those describe "a background job just filled in some fields" — see that file's own header.
  await events?.publish(companyId, { documentId: existing.id, typeId: TYPE_ID, kind: 'ocr-backfilled' });
}

/**
 * The job body proper — see this file's own header for the full step-by-step. Returns the SAME
 * `{ extraction, supplierMatch, ocr }` shape the synchronous upload path always returned, read back by
 * `ReceivedInvoiceOcrDispatcher.getResult` once BullMQ reports this job `completed`.
 */
export async function runReceivedInvoiceOcrJob(
  input: RunReceivedInvoiceOcrJobInput,
): Promise<RunReceivedInvoiceOcrJobResult> {
  const bytes = await readInboundFile(input.companyId, input.fileRef, input.mime);
  if (!bytes) {
    throw new ReceivedInvoiceFileMissingError(input.companyId, input.fileRef);
  }

  const {
    syntax,
    fields: extractedFields,
    ocr,
  } = await applyOcrFallback({ syntax: null, fields: {} }, bytes, input.mime, input.fileName);

  const supplierMatch = await reconcileSupplierClient(input.companyId, {
    vatId: extractedFields.supplierVatId,
    supplierName: extractedFields.supplier,
  });
  const fields: Record<string, unknown> = { ...extractedFields };
  if (supplierMatch.outcome === 'matched') {
    fields.supplierClient = supplierMatch.clientId;
  }

  await backfillReceivedInvoice(input.companyId, input.fileRef, fields, input.events);

  return { extraction: { syntax, fields }, supplierMatch, ocr };
}
