/**
 * The single point of enqueueing, polling, AND configuring the received-invoice OCR queue — the only
 * class that `@InjectQueue(Q_RECEIVED_INVOICE_OCR)`s it, the same "only this class touches the raw
 * Queue" discipline `document-queue.dispatcher.ts` already holds for the document-action queue.
 * `received-invoices.service.ts` depends on this concrete class directly (never `import type` — a DI
 * token, see this repo's own CLAUDE.md): `upload()` calls `enqueue`, the new
 * `GET .../upload/:fileRef/ocr` route calls `getResult`, and
 * `DocumentsQueueWorkerModule.onApplicationBootstrap` calls `applyGlobalConcurrency` (see that
 * method's own header) so the CLUSTER-WIDE OCR cap is set wherever this queue is consumed.
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OcrOutcome } from '../received-invoices/ocr/apply-ocr-fallback';
import {
  Q_RECEIVED_INVOICE_OCR,
  readReceivedInvoiceOcrConcurrency,
  ReceivedInvoiceOcrJobData,
} from '../received-invoices/ocr/ocr-queue.constants';
import { RunReceivedInvoiceOcrJobResult } from '../received-invoices/ocr/run-ocr-job';
import { SupplierMatchResult } from '../received-invoices/supplier-reconciliation';

/** `ocr-<companyId>-<fileRef>` — `-`, never `:` (BullMQ forbids a single `:` in a custom job id, the
 *  same reason `document-action-job.ts#buildDocumentActionJobId` documents). `companyId` embedded
 *  directly in the id is what makes tenant isolation structural rather than a query-time filter: a
 *  company can only ever ask `getResult` with ITS OWN `companyId` (`@ActiveCompany()`, never a
 *  request-supplied value), so there is no id another tenant could guess their way into even knowing a
 *  real `fileRef`. */
function buildReceivedInvoiceOcrJobId(companyId: string, fileRef: string): string {
  return `ocr-${companyId}-${fileRef}`;
}

/**
 * What `GET .../upload/:fileRef/ocr` (`received-invoices.controller.ts`) returns, read back by
 * `getResult` below. `'done'` covers BOTH a genuinely completed job (whose own `job.returnvalue` is
 * spread in verbatim — the exact `{ extraction, supplierMatch, ocr }` shape `run-ocr-job.ts` returns)
 * and a job that FAILED outright (missing bytes, an unexpected throw): the route contract deliberately
 * never surfaces a queue-level failure as anything other than the SAME honest `ocr: { outcome:
 * 'failed', ... }` shape a provider-side OCR failure already uses — a polling frontend needs to tell
 * "still running" apart from "finished (however that turned out)", never a THIRD state for "the queue
 * itself broke".
 */
export type ReceivedInvoiceOcrResult =
  | { status: 'pending' }
  | {
      status: 'done';
      extraction: { syntax: string | null; fields: Record<string, unknown> };
      supplierMatch: SupplierMatchResult;
      ocr: OcrOutcome;
    };

@Injectable()
export class ReceivedInvoiceOcrDispatcher {
  private readonly logger = new Logger(ReceivedInvoiceOcrDispatcher.name);

  constructor(
    @InjectQueue(Q_RECEIVED_INVOICE_OCR) private readonly queue: Queue<ReceivedInvoiceOcrJobData>,
  ) {}

  /**
   * Enforces `RECEIVED_INVOICE_OCR_CONCURRENCY` as a CLUSTER-WIDE cap, not merely a per-worker one —
   * `@Processor()`'s own `concurrency` option (`received-invoice-ocr.processor.ts`) only bounds how
   * many jobs ONE worker process runs at once, so N worker replicas each honoring "1" still let N OCR
   * requests hit the single OCR container simultaneously (a scaled deployment's whole point is N > 1).
   * `Queue.setGlobalConcurrency` (BullMQ 5.x) stores the cap in REDIS and BullMQ enforces it across
   * every worker consuming this queue, cluster-wide, regardless of how many replicas there are — this
   * is the only class that holds the raw `Queue`, so it is the only place this call can be made from.
   *
   * Called from `DocumentsQueueWorkerModule.onApplicationBootstrap`, i.e. once per process that
   * consumes this queue (the API inline by default, or every `ROLE=worker` replica when
   * `WORKER_INLINE=false`) — deliberately idempotent rather than guarded to run only once
   * cluster-wide: every replica in a Helm release shares the exact same
   * `RECEIVED_INVOICE_OCR_CONCURRENCY` env value, so the LAST replica to boot simply re-writes the
   * same number Redis already held — a harmless no-op, not a race to win. A rolling deploy that
   * changes the value converges to the new cap as soon as any one replica has booted with it, rather
   * than waiting on a single elected writer.
   */
  async applyGlobalConcurrency(): Promise<void> {
    const concurrency = readReceivedInvoiceOcrConcurrency();
    await this.queue.setGlobalConcurrency(concurrency);
    this.logger.log(`Received-invoice OCR queue global concurrency set to ${concurrency}.`);
  }

  /**
   * Enqueues one OCR job under its deterministic jobId — same "clear a TERMINAL job before adding a
   * fresh one, leave an IN-FLIGHT one alone" pattern `document-queue.dispatcher.ts#enqueueAction`
   * documents in full (and for the identical reason: BullMQ refuses to add a job whose id already
   * exists, including one that already finished). Reachable in practice only when the SAME `fileRef`
   * is uploaded again after its own OCR job already completed or failed — the duplicate-upload check
   * in `received-invoices.service.ts#upload` refuses an exact repeat of an already-RECEIVED invoice,
   * but a preview that was never confirmed leaves nothing to compare against, so re-uploading the
   * identical bytes is a real, legitimate case this dispatcher must not silently ignore.
   */
  async enqueue(input: ReceivedInvoiceOcrJobData): Promise<void> {
    const jobId = buildReceivedInvoiceOcrJobId(input.companyId, input.fileRef);

    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
        this.logger.log(`Cleared ${state} OCR job ${jobId} so a fresh attempt can run.`);
      } else {
        this.logger.log(`OCR job ${jobId} is already ${state} — not enqueuing a duplicate.`);
        return;
      }
    }

    await this.queue.add('run', input, {
      jobId,
      attempts: 1,
      // Capped, not unbounded: a completed/failed OCR job only needs to survive long enough for the
      // upload dialog's own polling to read it back — `age: 3600` (an hour) is comfortably past any
      // realistic "left the tab open" window, while never growing the queue forever the way
      // `removeOnComplete: true` (immediate removal, the document-action queue's own choice) would
      // instead risk a poll landing in the gap between "completed" and "removed".
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 3600 },
    });
    this.logger.log(`OCR job ${jobId} enqueued for company ${input.companyId} (fileRef ${input.fileRef}).`);
  }

  /**
   * Reads back this OCR job's current state — `null` (never throws) when no job exists at all under
   * this exact `(companyId, fileRef)` pair, which `received-invoices.controller.ts` turns into a named
   * 404: expired (past `removeOnComplete`/`removeOnFail`'s own `age: 3600`) or simply never enqueued
   * (a structural/non-PDF deposit, or an instance with no OCR configured — neither ever calls
   * `enqueue` in the first place).
   */
  async getResult(companyId: string, fileRef: string): Promise<ReceivedInvoiceOcrResult | null> {
    const jobId = buildReceivedInvoiceOcrJobId(companyId, fileRef);
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    if (state === 'waiting' || state === 'active' || state === 'delayed') {
      return { status: 'pending' };
    }

    if (state === 'failed') {
      // The job itself threw (missing bytes — `run-ocr-job.ts#ReceivedInvoiceFileMissingError` — or
      // any other unexpected error): `applyOcrFallback` itself never throws (see its own header), so
      // reaching this branch always means something OUTSIDE ordinary OCR provider failure went wrong.
      // `extractorId: 'unknown'` — a queue-level failure has no extractor to name; the honest,
      // `outcome: 'failed'` OcrOutcome shape is reused regardless, so the polling frontend never needs
      // a THIRD failure shape to render (see this type's own header).
      return {
        status: 'done',
        extraction: { syntax: null, fields: {} },
        supplierMatch: { outcome: 'unmatched', reason: 'no-criteria' },
        ocr: {
          outcome: 'failed',
          extractorId: 'unknown',
          message: job.failedReason ?? 'The OCR job failed for an unknown reason.',
        },
      };
    }

    // 'completed' — `job.returnvalue` IS the exact `{ extraction, supplierMatch, ocr }` shape
    // `run-ocr-job.ts#runReceivedInvoiceOcrJob` returned, read back verbatim (BullMQ persists a job's
    // return value as its own JSON-serialized `returnvalue` field).
    const result = job.returnvalue as RunReceivedInvoiceOcrJobResult;
    return { status: 'done', ...result };
  }
}
