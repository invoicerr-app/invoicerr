/**
 * The outbound-webhook delivery queue. It is separate from the document queue because a dispatch has
 * nothing to do with documents. Its BullMQ config key must be named: `BullModule.forRoot()` is always
 * global, so an unnamed call would silently share (and last-write-win) another queue's Redis options.
 */
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

export const Q_WEBHOOK_DELIVERY = 'webhook-delivery';
export const WEBHOOK_BULL_CONFIG_KEY = 'webhooks';
export const WEBHOOK_DELIVERY_JOB_NAME = 'deliver';

/**
 * One delivery job, scoped to exactly one subscriber: retrying a job that fanned out to several
 * webhooks would redeliver to the ones that already succeeded.
 *
 * `companyId` is resolved at enqueue time and never re-derived here. `webhookId` is re-read fresh on
 * every attempt, so an edited URL or secret is honoured and a deleted webhook is a no-op. No dedup key:
 * two dispatches of the same event are two real occurrences.
 */
export interface WebhookDeliveryJobData {
  companyId: string;
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

/**
 * Attempts before giving up, env-overridable like the sibling queues. 7 attempts with the backoff
 * below span roughly an hour, enough for an endpoint down for that long to recover.
 */
export function readWebhookQueueAttempts(): number {
  return parseInt(process.env.WEBHOOK_QUEUE_ATTEMPTS ?? '7', 10);
}

/** Base delay of the exponential backoff, in ms; see `readWebhookQueueAttempts` for the total window. */
export function readWebhookQueueBackoffMs(): number {
  return parseInt(process.env.WEBHOOK_QUEUE_BACKOFF_MS ?? '60000', 10);
}
