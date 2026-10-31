/**
 * The queue's only processor: one generic worker for every outbound event, consuming what
 * `WebhookDispatcherService.dispatch` enqueues.
 */
import { Job } from 'bullmq';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';

import { runWithCompanyId } from '@/lib/request-context';
import { logger } from '@/logger/logger.service';

import { WebhookDeliveryService } from '../webhook-delivery.service';
import {
  Q_WEBHOOK_DELIVERY,
  WEBHOOK_BULL_CONFIG_KEY,
  WEBHOOK_DELIVERY_JOB_NAME,
  WebhookDeliveryJobData,
} from './webhook-queue.constants';

// Must match `webhooks-core.module.ts`'s own config key, or this worker resolves the default shared
// Redis connection instead of this queue's (see `WEBHOOK_BULL_CONFIG_KEY`).
@Processor({ name: Q_WEBHOOK_DELIVERY, configKey: WEBHOOK_BULL_CONFIG_KEY })
export class WebhookDeliveryProcessor extends WorkerHost {
  constructor(private readonly delivery: WebhookDeliveryService) {
    super();
  }

  /**
   * Delivers to the one subscriber this job names. It must throw on failure: that is what schedules
   * the next retry and, once attempts are spent, fires `failed` below.
   *
   * `runWithCompanyId` gives the worker the tenant context its Log rows need, since it has no HTTP
   * request of its own to carry one.
   */
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    if (job.name !== WEBHOOK_DELIVERY_JOB_NAME) {
      throw new Error(`Unknown job "${job.name}" on the ${Q_WEBHOOK_DELIVERY} queue`);
    }
    const { companyId, webhookId, event, payload } = job.data;
    return runWithCompanyId(companyId, () => this.delivery.deliver(companyId, webhookId, event, payload));
  }

  /**
   * Runs after every failed attempt; `attemptsMade` against the configured `attempts` tells a retry
   * from the terminal failure. `deliver` logs a WARN per attempt, this logs the terminal ERROR.
   *
   * Never throws: an exception in an `@OnWorkerEvent` handler is an unhandled rejection that kills the
   * worker process.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookDeliveryJobData> | undefined, error: Error): void {
    if (!job) return;

    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      // Not the end — BullMQ's own backoff already has another attempt scheduled.
      return;
    }

    const { companyId, event } = job.data;
    runWithCompanyId(companyId, () => {
      logger.error('Webhook delivery permanently failed — every retry attempt was exhausted', {
        category: 'webhook-dispatcher',
        companyId,
        details: { event, attempts, jobId: job.id, message: error.message },
      });
    });
  }
}
