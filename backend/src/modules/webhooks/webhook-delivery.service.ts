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
 * The actual outbound reach for ONE (event, webhook) pair — this is the logic
 * `WebhookDispatcherService.dispatch` used to run inline, for EVERY subscriber at once, in the request
 * or job that produced the event, before delivery moved onto its own queue
 * (`queue/webhook-delivery.processor.ts` is the only production caller now). Extracted into its own
 * class rather than kept as a private method on the dispatcher: the dispatcher's own job is now
 * ENQUEUEING (fast, no network call, no driver dependency beyond the one `prisma.webhook.findMany` read
 * that decides how many jobs to create — see that file's own header), while this class is what actually
 * reaches ONE endpoint.
 *
 * `companyId` here is ALREADY resolved — `dispatch`'s own `payload.companyId ?? payload.company?.id`
 * fallback, and its refusal when neither is present, both ran once at enqueue time. `webhookId` is
 * re-resolved to a FRESH row on every call (including every retry) rather than trusting a snapshot
 * carried on the job — a URL or secret edited between enqueue and a later retry is picked up
 * immediately, and a webhook deleted (or reassigned to another company) in the meantime is a clean
 * no-op, never a delivery to a URL nobody configured any more.
 *
 * A non-2xx response (or the outbound-URL guard refusing the send — see `WebhooksService.send`'s own
 * header) is treated as a FAILURE worth retrying, not a silent success: every driver's own `send()`
 * returns `res.ok` as a plain boolean rather than throwing for an HTTP-level failure (a 500, a 503 —
 * the single most common shape "this endpoint is down" actually takes), so `deliver` is the one place
 * that turns "the driver reported failure" into the thrown error BullMQ's own retry/backoff reacts to.
 * Without this, an endpoint that is up but erroring would never be retried at all — the queue's whole
 * point, silently defeated for the most realistic failure this was built for.
 *
 * Logs exactly the same two lines the pre-queue `dispatch()` did ("Webhook dispatched" on success,
 * a WARN on failure — both `category: 'webhook-dispatcher'`, both scoped by `companyId`) so the
 * per-company Log stream that already surfaces a failed webhook today keeps surfacing one, attempt by
 * attempt, now that there can be more than one. This method's own failure log is deliberately silent on
 * whether BullMQ will retry — `queue/webhook-delivery.processor.ts`'s own `@OnWorkerEvent('failed')`
 * handler is the ONE place that decides "one more attempt coming" from "every attempt is now spent",
 * and logs the latter at a higher severity — see that file's own header.
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

    // Gone, or moved to another company, since this job was enqueued — nothing to deliver, and NOT a
    // failure: retrying would only ever repeat the same "nothing here" outcome. `companyId` is checked
    // too, not just existence, for the identical tenant-scoping reason `WebhookDispatcherService.
    // dispatch`'s own refusal exists (a deleted-then-recreated id under a DIFFERENT company must never
    // deliver that company's traffic to this job's own, stale companyId's logs).
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
        // `send()` never throws for an HTTP-level failure (a non-2xx response) or a guard refusal —
        // both come back as a plain `false` (see this class's own header). Turning that into a thrown
        // error here is what makes BullMQ's retry/backoff actually engage for those cases, not only for
        // a genuine network-level failure (connection refused, DNS failure, timeout).
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
      // WARN, not ERROR: this single attempt failed, but whether that is "fine, BullMQ will retry" or
      // "every attempt is now spent" is not a fact this method has — `job.attemptsMade` vs. the job's
      // own configured `attempts` lives on the processor's side. An intermediate attempt failing is
      // exactly what the retry/backoff exists for, not yet the event worth an operator's attention;
      // the processor's own `onFailed` handler is what escalates to ERROR once retrying is truly done.
      logger.warn('Webhook delivery attempt failed', {
        category: 'webhook-dispatcher',
        companyId,
        details: { error, event, webhook: summary },
      });
      throw error;
    }
  }
}
