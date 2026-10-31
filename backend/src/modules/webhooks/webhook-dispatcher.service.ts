import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  Q_WEBHOOK_DELIVERY,
  readWebhookQueueAttempts,
  readWebhookQueueBackoffMs,
  WEBHOOK_DELIVERY_JOB_NAME,
  WebhookDeliveryJobData,
} from './queue/webhook-queue.constants';

/**
 * A dispatch must resolve to a tenant. The runtime refusal in `dispatch` is the real guarantee; the
 * optional types only keep existing callers compiling.
 */
export type WebhookDispatchPayload = { companyId?: string; company?: { id: string } } & Record<
  string,
  unknown
>;

/**
 * Looks up which webhooks subscribe to `event` and enqueues one delivery job per subscriber,
 * returning once Redis has them. Delivery happens in `queue/webhook-delivery.processor.ts`.
 * Order between jobs is not guaranteed, which is why payloads carry `occurredAt`.
 */
@Injectable()
export class WebhookDispatcherService {
  constructor(@InjectQueue(Q_WEBHOOK_DELIVERY) private readonly queue: Queue<WebhookDeliveryJobData>) {}

  async dispatch(event: WebhookEvent, payload: WebhookDispatchPayload): Promise<void> {
    const companyId = payload.companyId ?? payload.company?.id;

    // No resolvable tenant means an unscoped query, which would leak every company's webhooks:
    // refuse the whole dispatch, loudly, before it reaches the queue.
    if (!companyId) {
      logger.error(
        'Refused to dispatch a webhook with no companyId — would have fanned out to every tenant',
        {
          category: 'webhook-dispatcher',
          details: { event },
        },
      );
      throw new Error(`WebhookDispatcherService.dispatch(${event}) called without a resolvable companyId`);
    }

    try {
      // One job per subscriber, so a retry only redelivers to the endpoint that failed.
      const webhooks = await prisma.webhook.findMany({
        where: { companyId, events: { has: event } },
        select: { id: true },
      });

      const attempts = readWebhookQueueAttempts();
      await Promise.all(
        webhooks.map((webhook) =>
          this.queue.add(
            WEBHOOK_DELIVERY_JOB_NAME,
            { companyId, webhookId: webhook.id, event, payload },
            {
              attempts,
              backoff: { type: 'exponential', delay: readWebhookQueueBackoffMs() },
              // Delivered jobs are cleared — nothing to inspect once a webhook genuinely went out.
              removeOnComplete: true,
              // Keep the last failures for inspection; higher than the document queue because this
              // queue sees far more volume.
              removeOnFail: { count: 200 },
            },
          ),
        ),
      );
    } catch (error) {
      logger.error('Failed to enqueue a webhook delivery', {
        category: 'webhook-dispatcher',
        companyId,
        details: { error, event },
      });
      throw error;
    }
  }
}
