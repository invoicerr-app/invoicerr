/**
 * The received-invoice OCR queue's ONLY processor — a thin `WorkerHost` shim over
 * `run-ocr-job.ts#runReceivedInvoiceOcrJob`, the same "the processor is plumbing, the plain function is
 * the logic" split `document-action.processor.ts` documents for the document-action queue. Lives in ITS
 * OWN `@Processor()` (never branching on `job.name` the way that processor does): this queue carries
 * exactly one job shape, enqueued only by `ReceivedInvoiceOcrDispatcher.enqueue`
 * (`../received-invoice-ocr.dispatcher.ts`), so there is nothing to dispatch on.
 *
 * `concurrency: readReceivedInvoiceOcrConcurrency()` — read ONCE, at class-decoration time (same
 * timing `@nestjs/bullmq`'s own `Worker` always reads a `@Processor()`'s options), independent of
 * `Q_DOCUMENT_ACTION`'s own concurrency: a burst of OCR jobs must never starve an ordinary "send" job's
 * own worker slot, and vice versa — see `ocr-queue.constants.ts`'s own header. This option alone only
 * bounds how many jobs THIS process's own worker runs at once — with several worker replicas it is NOT
 * a cluster-wide cap on the OCR container's own load; that cap is `Queue.setGlobalConcurrency`,
 * applied at boot by `ReceivedInvoiceOcrDispatcher.applyGlobalConcurrency` (the only class holding the
 * raw `Queue`), using the exact same `readReceivedInvoiceOcrConcurrency()` value so the two never
 * drift apart — see that method's own header.
 *
 * Provided in `document-queue-worker.module.ts`, so the existing `WORKER_INLINE` gate applies exactly
 * the way it already does for `DocumentActionProcessor`: the API process consumes inline by default,
 * a scaled deployment's dedicated `ROLE=worker` process consumes instead when `WORKER_INLINE=false`.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  Q_RECEIVED_INVOICE_OCR,
  readReceivedInvoiceOcrConcurrency,
  ReceivedInvoiceOcrJobData,
} from '../../received-invoices/ocr/ocr-queue.constants';
import {
  runReceivedInvoiceOcrJob,
  RunReceivedInvoiceOcrJobResult,
} from '../../received-invoices/ocr/run-ocr-job';
import { DocumentEventsPublisher } from '../document-events-publisher';

@Processor(Q_RECEIVED_INVOICE_OCR, { concurrency: readReceivedInvoiceOcrConcurrency() })
export class ReceivedInvoiceOcrProcessor extends WorkerHost {
  constructor(private readonly eventsPublisher: DocumentEventsPublisher) {
    super();
  }

  /**
   * No try/catch: a thrown error (`run-ocr-job.ts#ReceivedInvoiceFileMissingError`, or anything else
   * unexpected) must propagate so BullMQ records this job as failed — `attempts: 1`
   * (`ReceivedInvoiceOcrDispatcher.enqueue`) means there is no retry to apply, but the failure still
   * has to land on the job itself for `ReceivedInvoiceOcrDispatcher.getResult`'s own "failed" branch to
   * ever have something (`job.failedReason`) to read back.
   */
  async process(job: Job<ReceivedInvoiceOcrJobData>): Promise<RunReceivedInvoiceOcrJobResult> {
    return runReceivedInvoiceOcrJob({ ...job.data, events: this.eventsPublisher });
  }
}
