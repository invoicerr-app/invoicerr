/**
 * Providers-only half of outbound webhooks — split out of `webhooks.module.ts` so a dedicated
 * `ROLE=worker` process can consume `Q_WEBHOOK_DELIVERY` too (`queue/webhooks-queue-worker.module.ts`,
 * the CONSUMING half), the same Core/HTTP/Worker split `documents-core.module.ts` /
 * `documents.module.ts` / `queue/document-queue-worker.module.ts` and `billing-core.module.ts` /
 * `billing.module.ts` / `billing-queue-worker.module.ts` already hold.
 *
 * BEFORE this split, `WebhookDispatcherService.dispatch()` made the outbound HTTP call itself, inline,
 * in whichever request or job triggered it — a slow or unreachable customer endpoint cost THAT caller
 * directly (worst case: `clients.service.ts`'s own `CLIENT_SEARCHED`, dispatched on every client
 * search). `dispatch()` now only enqueues (`webhook-dispatcher.service.ts`'s own header covers why, and
 * the ordering trade-off accepted); the actual delivery (`WebhookDeliveryService`, provided here) runs
 * on whichever process consumes `Q_WEBHOOK_DELIVERY`.
 *
 * `exports: [BullModule, ...]` is what lets `queue/webhooks-queue-worker.module.ts`'s own
 * `@InjectQueue(Q_WEBHOOK_DELIVERY)`/`@Processor()` resolve a connection registered under
 * `WEBHOOK_BULL_CONFIG_KEY` without redefining it — see `queue/webhook-queue.constants.ts`'s own header
 * for why an unnamed `forRoot()` here would be a bug.
 *
 * Does NOT provide `WebhookDeliveryProcessor` — that is the CONSUMING half's own job
 * (`queue/webhooks-queue-worker.module.ts`), exactly mirroring `billing-core.module.ts` versus
 * `billing-queue-worker.module.ts`.
 */
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { redisConnection } from '../documents/queue/redis.config';
import { Q_WEBHOOK_DELIVERY, WEBHOOK_BULL_CONFIG_KEY } from './queue/webhook-queue.constants';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    BullModule.forRoot(WEBHOOK_BULL_CONFIG_KEY, { connection: redisConnection() }),
    BullModule.registerQueue({ configKey: WEBHOOK_BULL_CONFIG_KEY, name: Q_WEBHOOK_DELIVERY }),
  ],
  providers: [WebhooksService, WebhookDispatcherService, WebhookDeliveryService],
  exports: [BullModule, WebhooksService, WebhookDispatcherService, WebhookDeliveryService],
})
export class WebhooksCoreModule {}
