/**
 * The webhook-delivery queue's ONLY processor — one generic worker for every outbound event, not one
 * processor per emitter. Consumes what `WebhookDispatcherService.dispatch` enqueues (that class's own
 * header covers why delivery moved here at all, and the ordering trade-off this move accepts).
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

// `configKey` must match `webhooks-core.module.ts`'s own `BullModule.forRoot()` call — see
// `WEBHOOK_BULL_CONFIG_KEY`'s own comment. Without it this worker would resolve its connection from the
// "default" shared config instead, defeating the self-containment that named config key exists to
// guarantee (silently working today only because every queue in this app happens to compute the
// identical `redisConnection()`).
@Processor({ name: Q_WEBHOOK_DELIVERY, configKey: WEBHOOK_BULL_CONFIG_KEY })
export class WebhookDeliveryProcessor extends WorkerHost {
  constructor(private readonly delivery: WebhookDeliveryService) {
    super();
  }

  /**
   * Replays `(companyId, webhookId, event, payload)` through `WebhookDeliveryService.deliver` — the
   * EXACT SAME lookup-and-send `WebhookDispatcherService.dispatch` used to run inline before this queue
   * existed, now scoped to the ONE subscriber this job names (see `WebhookDeliveryJobData`'s own header
   * for why per-subscriber, not per-event). Left to throw on failure, deliberately: that is what tells
   * BullMQ to schedule the next retry (or, once `attempts` is spent, to fire the `failed` event
   * `onFailed` below reacts to) — swallowing it here would silently turn every delivery failure into a
   * false "succeeded".
   *
   * Wrapped in `runWithCompanyId` — this worker has no HTTP request of its own to carry a company
   * through `AsyncLocalStorage` (see `@/lib/request-context.ts`'s own header), and `WebhookDeliveryService.
   * deliver`/`WebhooksService.send` both write `Log` rows that need one for the per-company Log screen
   * to ever show them.
   */
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    if (job.name !== WEBHOOK_DELIVERY_JOB_NAME) {
      throw new Error(`Unknown job "${job.name}" on the ${Q_WEBHOOK_DELIVERY} queue`);
    }
    const { companyId, webhookId, event, payload } = job.data;
    return runWithCompanyId(companyId, () => this.delivery.deliver(companyId, webhookId, event, payload));
  }

  /**
   * Fires after EVERY failed attempt, not only the last one — `job.attemptsMade` (already incremented
   * for this attempt by BullMQ before the event fires) compared against the job's own configured
   * `attempts` (`webhook-queue.constants.ts#readWebhookQueueAttempts`) is what tells "one more retry is
   * coming" apart from "this was the terminal failure", the identical idiom
   * `document-action.processor.ts`'s own `onFailed` uses for `DOCUMENT_SEND_FAILED`.
   *
   * `WebhookDeliveryService.deliver` already logs a WARN on every attempt (its own header explains why
   * only WARN — it cannot tell terminal from retryable on its own). THIS log is the terminal one: ERROR
   * severity, same `category: 'webhook-dispatcher'` the pre-queue `dispatch()` used for its own (single,
   * unretried) failure — so a search that used to find a failed webhook by filtering ERROR-level
   * `webhook-dispatcher` log lines still finds it here, once retrying is genuinely done rather than
   * after every attempt.
   *
   * Never throws — `@OnWorkerEvent` handlers are event listeners, not a BullMQ-retried job attempt:
   * anything they throw becomes an unhandled rejection that kills the whole worker process (this is not
   * theoretical — `document-action.processor.ts`'s own `onFailed` header names the exact 2026-08-31
   * incident this discipline exists to prevent). `logger.error` itself never throws (it swallows its own
   * write failure — see `logger.service.ts`), so no try/catch is needed here beyond the `job` presence
   * check BullMQ's own typings require.
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
