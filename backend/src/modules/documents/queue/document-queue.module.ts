/**
 * Global BullMQ wiring for the document-action queue — the enqueue-capable half. `@Global()` so
 * `@InjectQueue(Q_DOCUMENT_ACTION)` and `DocumentQueueDispatcher` are available anywhere in the app
 * (action handlers to ENQUEUE; the worker's own processor module to CONSUME) without every module
 * re-importing this one — the exact same shape the pre-refonte compliance queue's own `QueueModule`
 * had (`avant-refonte-documents`, compliance/nest/queue/queue.module.ts), carried over almost
 * verbatim for this branch's document-action queue.
 *
 * Imported (indirectly, via `DocumentsCoreModule`) by EVERY process that boots `DocumentsModule` —
 * API or worker — which is precisely what makes Redis REQUIRED at boot (see
 * `DocumentQueueRedisRequiredGuard`'s own header): there is no code path that boots the documents
 * module without also trying to reach Redis.
 */
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { Q_RECEIVED_INVOICE_OCR } from '../received-invoices/ocr/ocr-queue.constants';
import { DocumentEventsPublisher } from './document-events-publisher';
import { DocumentQueueDispatcher } from './document-queue.dispatcher';
import { Q_DOCUMENT_ACTION } from './queue.constants';
import { ReceivedInvoiceOcrDispatcher } from './received-invoice-ocr.dispatcher';
import { redisConnection } from './redis.config';
import { DocumentQueueRedisRequiredGuard } from './redis-required.guard';

@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: Q_DOCUMENT_ACTION }),
    // A DEDICATED queue for received-invoice OCR (`ocr-queue.constants.ts`) — its own concurrency cap
    // (`RECEIVED_INVOICE_OCR_CONCURRENCY`) so a burst of CPU-heavy Tesseract jobs can never throttle
    // Q_DOCUMENT_ACTION's own worker slot(s), and vice versa. Registered here (never a second
    // `BullModule.forRoot`) so both queues share the ONE Redis connection this module already opens.
    BullModule.registerQueue({ name: Q_RECEIVED_INVOICE_OCR }),
  ],
  // `DocumentEventsPublisher` (T1/R8 — the worker→API status bridge, see its own header) lives here,
  // not in `DocumentsCoreModule`: EVERY process that boots the documents system (API or a scaled
  // worker) needs to PUBLISH — the write side never needs the SSE-side `DocumentEventsBridge`
  // (`documents.module.ts`, API-process-only), so it stays out of this Global module entirely.
  //
  // `ReceivedInvoiceOcrDispatcher` lives here for the identical reason `DocumentQueueDispatcher` does:
  // `received-invoices.service.ts#upload` (API process) needs to ENQUEUE, and
  // `ReceivedInvoiceOcrProcessor` (`processors/received-invoice-ocr.processor.ts`, a provider of
  // `DocumentsQueueWorkerModule`) needs the SAME class available wherever it boots — `@Global()` makes
  // both resolve it without either module importing this one explicitly.
  providers: [
    DocumentQueueDispatcher,
    DocumentQueueRedisRequiredGuard,
    DocumentEventsPublisher,
    ReceivedInvoiceOcrDispatcher,
  ],
  exports: [BullModule, DocumentQueueDispatcher, DocumentEventsPublisher, ReceivedInvoiceOcrDispatcher],
})
export class DocumentQueueModule {}
