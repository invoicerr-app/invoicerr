/**
 * Providers-only half of outbound webhooks, split so a `ROLE=worker` process can consume the queue
 * too. `BullModule` is exported so the consumer resolves the same named connection. The processor
 * itself belongs to the consuming half.
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
