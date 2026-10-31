import { Module } from '@nestjs/common';

import { WebhooksCoreModule } from '../webhooks-core.module';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

/**
 * The consuming half of the outbound-webhook queue: imported by `WorkerModule` always, and by
 * `AppModule` when `WORKER_INLINE` is not `false`. It imports the Core half, never the HTTP one, and
 * registers no repeatable because every job is a one-off delivery.
 */
@Module({
  imports: [WebhooksCoreModule],
  providers: [WebhookDeliveryProcessor],
})
export class WebhooksQueueWorkerModule {}
