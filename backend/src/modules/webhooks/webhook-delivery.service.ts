import { Injectable } from '@nestjs/common';

import { Webhook, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { WebhooksService } from './webhooks.service';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

/** What actually goes into a dispatch log line — never the row itself, which carries `secret`. */
function summarizeWebhook(webhook: Pick<Webhook, 'id' | 'url' | 'type'>) {
  return { id: webhook.id, url: webhook.url, type: webhook.type };
}

/**
 * Delivers to one (event, webhook) endpoint: the dispatcher only enqueues, this class sends. The
 * webhook row is re-read on every attempt, so an edited URL is honoured and a deleted or reassigned
 * webhook is a no-op. A non-2xx answer or a guard refusal becomes a thrown error: that is what
 * engages the queue's retry.
 */
@Injectable()
export class WebhookDeliveryService {
  constructor(private readonly webhooksService: WebhooksService) {}

  async deliver(
    companyId: string,
    webhookId: string,
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });

    // Gone, or reassigned to another company, since the job was enqueued: nothing to deliver, and
    // retrying would repeat the same outcome.
    if (!webhook || webhook.companyId !== companyId) {
      logger.info('Webhook delivery skipped — the webhook no longer exists for this company', {
        category: 'webhook-dispatcher',
        companyId,
        details: { event, webhookId },
      });
      return;
    }

    const summary = summarizeWebhook(webhook);

    try {
      const [delivered] = await this.webhooksService.send([webhook], event, payload);
      if (!delivered) {
        // `send` reports an HTTP failure or a guard refusal as `false` rather than throwing; throwing
        // here is what makes BullMQ retry it.
        throw new Error(
          'Webhook endpoint did not accept the delivery (non-2xx response, or refused by the outbound-URL guard)',
        );
      }
      logger.info('Webhook dispatched', {
        category: 'webhook-dispatcher',
        companyId,
        details: { event, webhook: summary },
      });
    } catch (error) {
      // WARN: this attempt failed, but only the processor knows whether retries remain.
      logger.warn('Webhook delivery attempt failed', {
        category: 'webhook-dispatcher',
        companyId,
        details: { error, event, webhook: summary },
      });
      throw error;
    }
  }
}
