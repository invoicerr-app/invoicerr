/**
 * The document-action queue's own constants and wire shapes — see this directory's header
 * (document-queue.module.ts) for the full split (Core providers / worker processors / WORKER_INLINE)
 * this module is part of.
 */
import { Logger } from '@nestjs/common';

import { ReportJobData } from '../reporting/report-job';

/** The ONE queue this whole mechanism needs — see document-action-job.ts's own header for why the
 *  job form is generic (companyId/typeId/documentId/actionId/payload) rather than one queue per
 *  business need: recurring documents are expected to reuse this exact same queue and job
 *  shape, only with its OWN scheduling deciding when to enqueue, never a second queue. */
export const Q_DOCUMENT_ACTION = 'document-action';

/**
 * One document-action job's data — see document-action-job.ts's `buildDocumentActionJobData` for how
 * this is built, and queue/processors/document-action.processor.ts for how it's consumed: the worker
 * replays `(companyId, typeId, documentId, actionId)` through `DocumentsService.runAction` — the
 * EXACT SAME execution path (and its four gates: country policy 403, status 409, implementation 501,
 * data validation 400) the API itself goes through for that same action. Nothing here is specific to
 * "send" — a future recurring-document job enqueues the exact same shape for whichever
 * action it needs replayed later.
 */
export interface DocumentActionJobData {
  companyId: string;
  typeId: string;
  documentId: string;
  actionId: string;
  /** Mirrors `RunActionDto`'s own two fields (dto/documents.dto.ts) — kept as a nested object,
   *  rather than flattened alongside `companyId`/`typeId`/..., so the job's own "envelope" fields
   *  (who/what/which action) are visually distinct from the ACTION's own input, the same separation
   *  `ActionContext` already holds between `data` and `params`. */
  payload: {
    data: Record<string, unknown>;
    params: Record<string, unknown>;
  };
}

/**
 * The narrow shape an action handler needs to hand a job off to the queue — deliberately NOT the
 * concrete, BullMQ-backed `DocumentQueueDispatcher` (document-queue.dispatcher.ts): every action file
 * that enqueues a job (actions/async-send.ts) depends on THIS interface alone, so a jest spec can pass
 * a bare `{ enqueueAction: jest.fn() }` with no Nest module, no Redis, and no BullMQ involved at all —
 * the same "depend on the narrow shape, not the concrete class" discipline `TransportRegistry`'s own
 * `DocumentTransport` interface already holds for a transport's `send()`.
 *
 * `enqueueReport` (declarative reporting — `reporting/report-on-send.ts`) is OPTIONAL, deliberately:
 * every EXISTING spec across quote/invoice/credit-note actions constructs a bare
 * `{ enqueueAction: jest.fn() }` and must keep type-checking unchanged — `report-on-send.ts` itself
 * treats an absent `enqueueReport` as "this dispatcher cannot report, so don't" (the same "no
 * capability, no effect" posture the rest of this codebase already holds, e.g. `sweepRunner`'s own
 * `@Optional()` in `document-action.processor.ts`), never a crash. Production wiring
 * (`DocumentQueueDispatcher`) always implements it.
 */
export interface DocumentActionQueueDispatcher {
  enqueueAction(input: DocumentActionJobData): Promise<void>;
  enqueueReport?(input: ReportJobData): Promise<boolean>;
}

const attemptsLogger = new Logger('DocumentActionQueueAttempts');

/** The last raw value this module refused, so a misconfigured instance says so ONCE rather than on
 *  every enqueue — the variable cannot change under a running process, so a second refusal of the
 *  same string carries no information the first one did not. */
let refusedAttemptsValue: string | undefined;

export const DEFAULT_DOCUMENT_ACTION_QUEUE_ATTEMPTS = 3;

/**
 * How many times BullMQ attempts one job on this queue before giving up — `DOCUMENT_ACTION_QUEUE_ATTEMPTS`,
 * default 3, paired with the exponential backoff (base 2s) both `enqueueAction` and `enqueueReport`
 * set. Read here, next to the queue's own constants, rather than inline at each `queue.add` call —
 * the same placement `webhook-queue.constants.ts#readWebhookQueueAttempts` already holds for the
 * webhook queue, and the reason this one now has a home of its own: the two dispatch sites read the
 * same variable and must not drift apart on how they interpret it.
 *
 * A value that is not a positive integer falls back to the default INSTEAD of reaching BullMQ,
 * because BullMQ does not recognise a nonsensical attempts count as nonsense. `Job.moveToFailed`
 * decides whether an attempt is left with `this.attemptsMade + 1 < this.opts.attempts`, and that
 * comparison is false for `NaN` (a typo such as `three`, or an empty string), for `0` and for a
 * negative number alike. So a malformed value does not SHRINK the retry budget — it removes it
 * entirely, while the process boots normally and logs nothing: every transient failure (a network
 * blip towards a national platform, a PDP briefly unavailable) then lands on `send_failed` at the
 * first attempt, which is precisely the retry this queue exists to provide.
 *
 * The refusal is logged, naming the value rejected and the value in force: falling back silently
 * would leave an operator who asked for 10 attempts running 3 with nothing to read that says so.
 */
export function readDocumentActionQueueAttempts(): number {
  const raw = process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS;
  if (raw === undefined) return DEFAULT_DOCUMENT_ACTION_QUEUE_ATTEMPTS;

  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  if (refusedAttemptsValue !== raw) {
    refusedAttemptsValue = raw;
    attemptsLogger.warn(
      `DOCUMENT_ACTION_QUEUE_ATTEMPTS="${raw}" is not a positive integer — using ` +
        `${DEFAULT_DOCUMENT_ACTION_QUEUE_ATTEMPTS} attempts instead. Passed to BullMQ as given it ` +
        'would disable retries altogether, not merely lower them.',
    );
  }
  return DEFAULT_DOCUMENT_ACTION_QUEUE_ATTEMPTS;
}
