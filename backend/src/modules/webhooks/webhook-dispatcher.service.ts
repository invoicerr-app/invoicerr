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

/**
 * `dispatch` no longer makes the outbound HTTP call itself — it looks up which webhooks are subscribed
 * to `event` (a fast, local Prisma read — see `WebhookDeliveryJobData`'s own header for why one job per
 * SUBSCRIBER, never one job per event) and ENQUEUES one delivery job per subscriber onto
 * `Q_WEBHOOK_DELIVERY`, returning as soon as that is durably recorded in Redis — before any customer
 * endpoint is ever reached. `queue/webhook-delivery.processor.ts` (consumed by the same worker fleet
 * every other queue in this codebase already runs on) is what actually calls `WebhookDeliveryService.
 * deliver`, with its own retries.
 *
 * Every EXISTING caller (`company.service.ts`, `clients.service.ts`, `webhooks.controller.ts`, and the
 * whole `DOCUMENT_WEBHOOK_EMITTER` family — `async-send.ts`, `mark-send-failed.ts`,
 * `document-authority-webhook.ts`, `conformity-sweep-runner.ts`, `reporting-runner.ts`,
 * `sdi-notifiche.service.ts`) already treats a webhook failure as non-fatal to its OWN write (every one
 * wraps this call in its own try/catch, precisely because a dead customer endpoint must never undo a
 * write that already succeeded) — so this signature and its "logs, then rethrows" contract stay
 * IDENTICAL, and none of those call sites need to change. What changes is WHAT can make it reject: before,
 * almost always the customer's own endpoint (slow, unreachable, erroring); now, only a resolvable
 * companyId being missing (a caller bug — see the guard below, unchanged) or the enqueue itself failing
 * (Redis unreachable) — both far rarer, and both things those existing catch blocks already handle.
 *
 * ## Ordering
 *
 * Before this queue existed, two webhook calls for the SAME document were, in practice, delivered in
 * the order they were triggered: each one was `await`ed inline, inside a document action, and this
 * codebase's own lifecycle claim (`persistence.ts#claimDocumentTransition`) already serializes actions
 * on one document to one at a time — action N's own webhook call had already resolved before action
 * N+1 could even begin. Moving delivery onto a queue consumed by 15 independent workers gives up that
 * incidental guarantee: two events enqueued moments apart can now be picked up by two DIFFERENT
 * workers, and if the OLDER one needs a retry (its target was briefly unreachable) while the NEWER one
 * succeeds on its first attempt, the newer one arrives first.
 *
 * A hard ordering guarantee across independent BullMQ jobs processed by independent workers is not
 * something this queue (or open-source BullMQ) provides without inventing a per-target sequencer —
 * disproportionate machinery for a change whose entire point is "nothing a user sees changes". The
 * decision here is the same one every mainstream webhook provider (Stripe, GitHub, Shopify) already
 * ships and documents to their own integrators: delivery order is NOT guaranteed, and a receiver that
 * cares must reconcile using the payload's own facts rather than assume arrival order — every
 * `DOCUMENT_*` payload already carries `occurredAt` (`document-webhooks.ts#buildDocumentWebhookPayload`)
 * for exactly that. What we do NOT do is make things WORSE than that baseline: jobs are enqueued and
 * dequeued FIFO (no priority, no artificial reordering of our own), and a job's retries stay attached
 * to that SAME job (BullMQ never lets a retry "jump" to the front of the queue ahead of jobs added
 * after it) — so reordering can only ever happen via the one mechanism above, a genuine delivery
 * failure needing a retry, never as a side effect of this queue's own bookkeeping.
 */
@Injectable()
export class WebhookDispatcherService {
  constructor(@InjectQueue(Q_WEBHOOK_DELIVERY) private readonly queue: Queue<WebhookDeliveryJobData>) {}

  async dispatch(event: WebhookEvent, payload: WebhookDispatchPayload): Promise<void> {
    const companyId = payload.companyId ?? payload.company?.id;

    // A dispatch with no resolvable tenant used to fall through to an UNSCOPED `findMany` — every
    // webhook of every company on the instance, regardless of who owns it. `CLIENT_SEARCHED`/
    // `CLIENT_CREATED`/`CLIENT_UPDATED`/`CLIENT_DELETED` never carried a companyId and so were
    // fanned out instance-wide: any tenant could register a webhook for those events and receive every
    // OTHER tenant's client data. That is a cross-tenant data leak, not a permissive default to
    // preserve — a missing companyId must refuse the whole dispatch rather than silently widen the
    // query to "every company". Checked HERE, before the job ever reaches the queue: a caller bug like
    // this one must fail loudly, in the request/job that made it, not surface as a mystery in a worker
    // minutes later.
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
      // Resolved ONCE here, never inside the job itself: one job per SUBSCRIBER (`webhookId`), never
      // one job that fans out to every subscriber internally — see `WebhookDeliveryJobData`'s own
      // header for the duplicate-delivery bug that shape would otherwise reintroduce now that retries
      // exist. A company with zero webhooks on this event enqueues nothing at all — a clean no-op,
      // where the pre-queue code used to still run (and log) an empty `Promise.all([])`.
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
              // Capped history kept on FINAL failure (every attempt spent) — a human reading the queue,
              // or a future "delivery history" screen, needs SOMETHING to inspect, the same reasoning
              // `document-queue.dispatcher.ts`'s own `removeOnFail: { count: 50 }` already documents. A
              // higher cap than that one: this queue can see far more volume (every client search,
              // every document event, every CRUD write) than the document-action queue's own
              // per-document jobs.
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
