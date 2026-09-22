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

import { DocumentEventsPublisher } from './document-events-publisher';
import { DocumentQueueDispatcher } from './document-queue.dispatcher';
import { Q_DOCUMENT_ACTION } from './queue.constants';
import { redisConnection } from './redis.config';
import { DocumentQueueRedisRequiredGuard } from './redis-required.guard';

@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: Q_DOCUMENT_ACTION }),
  ],
  // `DocumentEventsPublisher` (T1/R8 — the worker→API status bridge, see its own header) lives here,
  // not in `DocumentsCoreModule`: EVERY process that boots the documents system (API or a scaled
  // worker) needs to PUBLISH — the write side never needs the SSE-side `DocumentEventsBridge`
  // (`documents.module.ts`, API-process-only), so it stays out of this Global module entirely.
  providers: [DocumentQueueDispatcher, DocumentQueueRedisRequiredGuard, DocumentEventsPublisher],
  exports: [BullModule, DocumentQueueDispatcher, DocumentEventsPublisher],
})
export class DocumentQueueModule {}
