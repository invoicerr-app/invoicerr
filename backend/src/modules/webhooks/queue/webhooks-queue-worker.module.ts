import { Module } from '@nestjs/common';

import { WebhooksCoreModule } from '../webhooks-core.module';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

/**
 * The CONSUMING half of the outbound-webhook queue — the gate target for `WORKER_INLINE` (default
 * `true`), the exact same split `app.module.ts`'s own comment documents for the documents queue,
 * mirrored by `billing-queue-worker.module.ts`/`transfer-queue-worker.module.ts`: `WorkerModule`
 * (`ROLE=worker`) ALWAYS imports this — webhooks work in self-hosted mode too (no enable/disable flag,
 * the same posture `transfer-queue-worker.module.ts` documents for its own feature), so unlike
 * billing's own worker import this one is never further gated; `AppModule` imports it only when
 * `WORKER_INLINE !== 'false'`.
 *
 * Imports `WebhooksCoreModule` (never `WebhooksModule`, which also carries the HTTP controller this
 * worker process has no use for) so `WebhookDeliveryProcessor` gets the SAME DI-wired
 * `WebhookDeliveryService`/`WebhooksService` the API process would have used inline.
 *
 * No repeatable to register here, unlike every sibling `*QueueWorkerModule` in this codebase (which
 * each register at least one sweep in `onApplicationBootstrap`): this queue carries no sweep at all —
 * every job is a one-off delivery `WebhookDispatcherService.dispatch()` enqueues the moment an event
 * actually happens, never on a schedule.
 */
@Module({
  imports: [WebhooksCoreModule],
  providers: [WebhookDeliveryProcessor],
})
export class WebhooksQueueWorkerModule {}
