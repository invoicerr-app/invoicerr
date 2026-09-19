import { Injectable } from '@nestjs/common';

import { Webhook, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { WebhooksService } from './webhooks.service';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

/**
 * Every dispatch payload must resolve to a tenant. `companyId` is the direct form every emitter
 * SHOULD use going forward (`buildDocumentWebhookPayload`, `webhooks.controller.ts`); `company.id` is
 * kept as an accepted alternative only because existing emitters (`company.service.ts`) already pass
 * the full updated row under that key. Both stay optional AT THE TYPE LEVEL — narrowing either to
 * required would only move the mistake to a compile error in every caller that has never carried a
 * company, not prevent it — so the real guarantee is the runtime refusal in `dispatch` below, which
 * cannot be bypassed by any payload shape.
 */
export type WebhookDispatchPayload = { companyId?: string; company?: { id: string } } & Record<
  string,
  unknown
>;

/** What actually goes into a dispatch log line — never the row itself, which carries `secret`. */
function summarizeWebhook(webhook: Pick<Webhook, 'id' | 'url' | 'type'>) {
  return { id: webhook.id, url: webhook.url, type: webhook.type };
}

@Injectable()
export class WebhookDispatcherService {
  constructor(private readonly webhookService: WebhooksService) {}

  async dispatch(event: WebhookEvent, payload: WebhookDispatchPayload): Promise<void> {
    const companyId = payload.companyId ?? payload.company?.id;

    // A dispatch with no resolvable tenant used to fall through to an UNSCOPED `findMany` — every
    // webhook of every company on the instance, regardless of who owns it. `CLIENT_SEARCHED`/
    // `CLIENT_CREATED`/`CLIENT_UPDATED`/`CLIENT_DELETED` never carried a companyId and so were
    // fanned out instance-wide: any tenant could register a webhook for those events and receive every
    // OTHER tenant's client data. That is a cross-tenant data leak, not a permissive default to
    // preserve — a missing companyId must refuse the whole dispatch rather than silently widen the
    // query to "every company".
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

    const webhooks = await prisma.webhook.findMany({ where: { companyId, events: { has: event } } });

    // `webhooks` carries each row's `secret` (needed by `send()` below to compute the HMAC signature) —
    // logging it verbatim would hand every reader of the log sink (an operator, a hosted-offer log
    // aggregator, anyone with access to `GET /api/logs`) the means to forge deliveries to a tenant's
    // own receiver. Only the non-secret fields are ever written to a log line.
    const summaries = webhooks.map(summarizeWebhook);

    try {
      await this.webhookService.send(webhooks, event, payload);
      // Explicit `companyId` on every log line below — this is the ONE choke point every dispatch in
      // the app funnels through (document actions, billing, clients…), reached from request-scoped AND
      // job-scoped callers alike; resolving it locally here (already done, two lines up, to build the
      // `webhooks` query itself) is simpler than trusting every one of those callers to have already
      // established an ambient context.
      logger.info('Webhook dispatched', {
        category: 'webhook-dispatcher',
        companyId,
        details: { event, webhooks: summaries },
      });
    } catch (error) {
      logger.error('Error dispatching webhook', {
        category: 'webhook-dispatcher',
        companyId,
        details: { error, event, webhooks: summaries },
      });
      throw error;
    }
  }
}
