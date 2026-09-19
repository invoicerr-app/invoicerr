/**
 * The outbound-webhook delivery queue's own constants and wire shape — see this directory's sibling
 * modules (`webhooks-core.module.ts` for the providers half, `webhooks-queue-worker.module.ts` for the
 * consuming half) for the full Core/HTTP/Worker split every queue in this codebase now holds.
 *
 * Webhooks get their OWN queue rather than joining `Q_DOCUMENT_ACTION` — plenty of dispatch call sites
 * (`company.service.ts`, `clients.service.ts`, `webhooks.controller.ts` itself) have nothing to do
 * with a document at all (`CLIENT_SEARCHED` fires on every client-list search), so folding this into
 * the documents module's own queue would make a document-agnostic concern depend on document
 * plumbing for no reason — the same "a dedicated queue for a self-contained feature" call
 * `billing-queue.constants.ts`/`transfer-queue.constants.ts` already made for their own features.
 *
 * `WEBHOOK_BULL_CONFIG_KEY` exists for the identical reason those two files document: `@nestjs/bullmq`'s
 * `BullModule.forRoot()` ALWAYS returns a `global: true` dynamic module regardless of who calls it, so
 * an UNNAMED call here would register the exact same default shared-config token the `@Global()`
 * `DocumentQueueModule`'s own `forRoot()` already provides — harmless only while both happen to compute
 * an identical `redisConnection()`, and a silent last-write-wins the moment either one's Redis options
 * diverge. Naming this module's own config key (used by both `webhooks-core.module.ts`'s `forRoot()`
 * and `WebhookDeliveryProcessor`'s own `@Processor()` options) makes this queue's self-containment real.
 */
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

export const Q_WEBHOOK_DELIVERY = 'webhook-delivery';
export const WEBHOOK_BULL_CONFIG_KEY = 'webhooks';
export const WEBHOOK_DELIVERY_JOB_NAME = 'deliver';

/**
 * One webhook-delivery job's data — deliberately scoped to exactly ONE subscriber. `dispatch()` used
 * to hand a single job "this event, deliver it to every webhook subscribed" and let
 * `WebhooksService.send` fan out to all of them internally in one `Promise.all` — harmless with no
 * retries (there was only ever one attempt), but WITH retries it is a real duplicate-delivery bug: if
 * a company has two webhooks on the same event and only one of them is down, retrying "the whole job"
 * would redeliver to the healthy one too, which already succeeded and owes nothing. One job per
 * `(event, webhookId)` pair makes a retry — and a final give-up — apply to exactly the ONE endpoint
 * that actually failed, never its siblings.
 *
 * `companyId` is here ALREADY RESOLVED — `WebhookDispatcherService.dispatch`'s own
 * `payload.companyId ?? payload.company?.id` fallback (the tenant-scoping guard that refuses a
 * dispatch with no resolvable company) runs exactly once, at enqueue time; the job never re-derives it
 * and never repeats that refusal. `webhookId` is resolved at enqueue time too (which webhooks are
 * subscribed, right now), but `WebhookDeliveryService.deliver` re-fetches that ONE row fresh by id on
 * every attempt — so a URL/secret edited between enqueue and a later retry is still picked up, and a
 * webhook deleted in the meantime is a clean no-op rather than a delivery to a URL nobody configured
 * any more.
 *
 * Unlike `DocumentActionJobData`, this job carries no `jobId`-derived DEDUP key on purpose: every
 * `dispatch()` call is a genuinely distinct OCCURRENCE (two calls for the same event are two real
 * events, e.g. two payments settling a moment apart), never a "replace the pending run for this
 * target" job the way a document action is — so nothing here should ever be deduplicated by BullMQ the
 * way `enqueueAction` deliberately dedupes.
 */
export interface WebhookDeliveryJobData {
  companyId: string;
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

/**
 * How many times BullMQ attempts one delivery before giving up — env-overridable, same
 * `parseInt(..., 10)` + numeric-fallback shape every sibling queue in this codebase reads its own
 * attempts count with (`DOCUMENT_ACTION_QUEUE_ATTEMPTS`). Default 7, paired with `readWebhookQueueBackoffMs`'s
 * own default 60s below: exponential backoff over 7 attempts (delays of 1/2/4/8/16/32 minutes between
 * attempts 1-7) sums to roughly 63 minutes from first failure to final give-up — long enough that a
 * customer endpoint down for "an hour" (the scenario this was sized against) gets a real chance to
 * recover before delivery is abandoned, short enough that a permanently dead endpoint does not occupy
 * a retry slot indefinitely. Both numbers are environment-tunable specifically so an operator who
 * knows their own customers' outage patterns is not stuck with this guess.
 */
export function readWebhookQueueAttempts(): number {
  return parseInt(process.env.WEBHOOK_QUEUE_ATTEMPTS ?? '7', 10);
}

/** The exponential backoff's own base delay, in ms — see `readWebhookQueueAttempts`'s own header for
 *  the combined "~1 hour of retrying" reasoning. */
export function readWebhookQueueBackoffMs(): number {
  return parseInt(process.env.WEBHOOK_QUEUE_BACKOFF_MS ?? '60000', 10);
}
