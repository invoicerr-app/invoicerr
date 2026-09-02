/**
 * The single point of enqueueing for the document-action queue — the Nest-injectable, BullMQ-backed
 * implementation of `DocumentActionQueueDispatcher` (queue.constants.ts) that action handlers
 * (actions/async-send.ts) are actually wired against in production (documents.module.ts). A jest spec
 * never needs this class at all — it depends on the narrow interface instead (see that file's own
 * header).
 *
 * Also owns the two RECURRENCE-specific queue operations (root TODO item 5) — the sweep's repeatable
 * registration and the occurrence job's own enqueue — kept on this SAME class rather than a second
 * one: `@InjectQueue(Q_DOCUMENT_ACTION)` is deliberately held in exactly one place, the same "only
 * this class touches the raw Queue" discipline the rest of this directory already holds for the
 * ordinary action job.
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  CONFORMITY_POLL_JOB_NAME,
  CONFORMITY_SWEEP_JOB_ID,
  CONFORMITY_SWEEP_JOB_NAME,
  ConformityPollJobData,
  readConformitySweepIntervalMs,
} from '../conformity/conformity-sweep';
import { buildReportJobId, DOCUMENT_REPORT_JOB_NAME, ReportJobData } from '../reporting/report-job';
import {
  readSweepIntervalMs,
  SCHEDULE_OCCURRENCE_JOB_NAME,
  SCHEDULE_SWEEP_JOB_ID,
  SCHEDULE_SWEEP_JOB_NAME,
  ScheduleOccurrenceJobData,
} from '../schedules/schedule-sweep';
import { buildDocumentActionJobId } from './document-action-job';
import { DocumentActionJobData, DocumentActionQueueDispatcher, Q_DOCUMENT_ACTION } from './queue.constants';

@Injectable()
export class DocumentQueueDispatcher implements DocumentActionQueueDispatcher {
  private readonly logger = new Logger(DocumentQueueDispatcher.name);

  constructor(@InjectQueue(Q_DOCUMENT_ACTION) private readonly queue: Queue<DocumentActionJobData>) {}

  /**
   * Enqueues one document-action job under its deterministic jobId. Carried over from the
   * pre-refonte compliance queue's own `enqueueTransmit` (`avant-refonte-documents`,
   * compliance-queue.dispatcher.ts) almost verbatim, including the exact bug fix its own comment
   * documents: a TERMINAL (completed/failed) job under this same id must be cleared before adding a
   * fresh one — BullMQ refuses to add a job whose id already exists, INCLUDING one that already
   * finished, and `removeOnFail` deliberately keeps a failure around for diagnosis. Without this, once
   * a document's first send attempt had exhausted its retries, every later re-`send` (the retry IS the
   * action itself — see actions/async-send.ts) would be silently accepted and do nothing: no new
   * attempt, no error, a document stuck at "send_failed" with a working-looking Retry button that
   * could not retry. Only a job that is WAITING, DELAYED, or ACTIVE — genuinely still in flight — is
   * left alone: that is exactly the idempotency this deterministic id exists to provide.
   */
  async enqueueAction(input: DocumentActionJobData): Promise<void> {
    const jobId = buildDocumentActionJobId(input.typeId, input.documentId, input.actionId);

    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
        this.logger.log(`Cleared ${state} job ${jobId} so a fresh attempt can run.`);
      } else {
        this.logger.log(`Job ${jobId} is already ${state} — not enqueuing a duplicate.`);
        return;
      }
    }

    const attempts = parseInt(process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS ?? '3', 10);
    await this.queue.add('run', input, {
      jobId,
      attempts,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      // Kept around (capped) on failure — queue/mark-send-failed.ts and a human reading the queue
      // both need SOMETHING to inspect once every retry is spent, the same reasoning the pre-refonte
      // dispatcher's own `removeOnFail: { count: 50 }` already documents.
      removeOnFail: { count: 50 },
    });
    this.logger.log(`Job ${jobId} enqueued (action="${input.actionId}", type="${input.typeId}").`);
  }

  /**
   * Registers the ONE repeatable sweep job — idempotent by design: BullMQ dedups a repeatable
   * definition by its own repeat key (which folds in the fixed `jobId` below) across the WHOLE
   * cluster, so calling this on every process boot (the API when `WORKER_INLINE` is true, or every
   * scaled worker replica otherwise — document-queue-worker.module.ts's own `onApplicationBootstrap`)
   * is safe, the same guarantee the pre-refonte compliance queue's own `registerRepeatables` documented
   * (`avant-refonte-documents`, compliance-queue.dispatcher.ts) for its daily report/sweep jobs.
   *
   * `attempts: 1` (no backoff/retry at the BullMQ level): a sweep pass that itself throws should be
   * loud (a real bug — a broken query, a bad env value), not silently retried moments later by BullMQ
   * — the NEXT scheduled sweep tick, `readSweepIntervalMs()` away, is already the natural retry for
   * "the sweep didn't run this time".
   */
  async registerScheduleSweepRepeatable(): Promise<void> {
    await this.queue.add(SCHEDULE_SWEEP_JOB_NAME, {} as unknown as DocumentActionJobData, {
      jobId: SCHEDULE_SWEEP_JOB_ID,
      repeat: { every: readSweepIntervalMs() },
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
    this.logger.log(`Registered the document-schedule sweep repeatable (every ${readSweepIntervalMs()}ms).`);
  }

  /**
   * Enqueues ONE occurrence job under `jobId` — an id the CALLER computes
   * (schedules/schedule-sweep.ts's `buildScheduleOccurrenceJobId`, already unique per
   * (schedule, occurrence)), never derived here the way `enqueueAction`'s own jobId is. Unlike
   * `enqueueAction`, a job already found under this id is skipped UNCONDITIONALLY, whatever its
   * state — see schedule-sweep.ts's own header for why re-running the SAME occurrence is never a
   * legitimate operation for a schedule, unlike an ordinary action's deliberate "retry via re-send"
   * design. Returns whether THIS CALL believes it enqueued something, purely for the sweep's own
   * logging (schedule-sweep-runner.ts) — the caller's own bookkeeping (advancing `nextRunAt`)
   * happens either way, since "someone else already dispatched this exact occurrence" is just as
   * much a completed dispatch as this call's own would have been.
   *
   * The `getJob` pre-check below is a fast-path/observability aid, NOT the actual safety net —
   * it is two separate Redis round trips (`getJob` then `add`), so two GENUINELY concurrent calls
   * for the same `jobId` (two overlapping sweep passes racing on the same due schedule) can both
   * observe "nothing exists yet" and both proceed to `add()`, both returning `true` here. The REAL
   * guarantee is BullMQ's OWN jobId idempotency: `Queue.add()` given an id that already exists never
   * creates a second, independent job entry — it resolves to the existing one. This is proven
   * directly (against a real Redis, with two genuinely concurrent calls) by
   * queue/__tests__/document-schedule-queue.redis.spec.ts's own "racing" test, which does NOT assert
   * on this method's return value for exactly that reason — only on the real, downstream outcome
   * (exactly one duplicate document, however this method's own bookkeeping happened to land).
   */
  async enqueueScheduleOccurrence(jobId: string, data: ScheduleOccurrenceJobData): Promise<boolean> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      this.logger.log(`Occurrence ${jobId} already dispatched — not enqueuing a duplicate.`);
      return false;
    }

    // `attempts: 1` — deliberately NOT the ordinary action job's own retry/backoff: a failed
    // occurrence's retry IS the schedule's NEXT occurrence (its own, later, differently-dated jobId
    // — schedule-sweep-runner.ts's own header), never a BullMQ-level re-attempt of this SAME one.
    await this.queue.add(SCHEDULE_OCCURRENCE_JOB_NAME, data as unknown as DocumentActionJobData, {
      jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    });
    this.logger.log(
      `Occurrence ${jobId} enqueued (schedule="${data.scheduleId}", action="${data.actionId}").`,
    );
    return true;
  }

  /**
   * Registers the ONE conformity-sweep repeatable — same idempotent-registration guarantee as
   * `registerScheduleSweepRepeatable` above (BullMQ dedups a repeatable definition by its own key
   * across the whole cluster), same `attempts: 1` reasoning (a sweep pass that itself throws is a
   * real bug, loud now rather than silently retried — the next tick, `readConformitySweepIntervalMs()`
   * away, is already the natural retry for "the sweep didn't run this time").
   */
  async registerConformitySweepRepeatable(): Promise<void> {
    await this.queue.add(CONFORMITY_SWEEP_JOB_NAME, {} as unknown as DocumentActionJobData, {
      jobId: CONFORMITY_SWEEP_JOB_ID,
      repeat: { every: readConformitySweepIntervalMs() },
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
    this.logger.log(
      `Registered the document-conformity sweep repeatable (every ${readConformitySweepIntervalMs()}ms).`,
    );
  }

  /**
   * Enqueues ONE conformity poll job under `jobId` — the CALLER's own wall-clock-window id
   * (`conformity-sweep.ts#buildConformityPollJobId`). Same "skip unconditionally if a job already
   * exists under this id, whatever its state" discipline `enqueueScheduleOccurrence` already holds,
   * for the identical reason: re-polling the SAME window is never legitimate — a genuine re-poll
   * happens at the NEXT window's own, differently-bucketed id. Same "fast-path pre-check, real
   * guarantee is BullMQ's own jobId idempotency" caveat as that method's own header — proven against
   * a real Redis by `queue/__tests__/document-conformity-queue.redis.spec.ts`'s own racing test.
   */
  async enqueueConformityPoll(jobId: string, data: ConformityPollJobData): Promise<boolean> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      this.logger.log(`Conformity poll ${jobId} already dispatched — not enqueuing a duplicate.`);
      return false;
    }

    await this.queue.add(CONFORMITY_POLL_JOB_NAME, data as unknown as DocumentActionJobData, {
      jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    });
    this.logger.log(`Conformity poll ${jobId} enqueued (document="${data.documentId}").`);
    return true;
  }

  /**
   * Enqueues ONE declarative-report job under its deterministic `report-<providerId>-<documentId>`
   * id (`reporting/report-job.ts#buildReportJobId`) — implements the OPTIONAL `enqueueReport` on
   * `DocumentActionQueueDispatcher` (queue.constants.ts), which is why `reporting/report-on-send.ts`
   * can depend on that narrow interface alone rather than this concrete class.
   *
   * A job already existing under this id is skipped UNCONDITIONALLY, whatever its state — the SAME
   * discipline `enqueueScheduleOccurrence`/`enqueueConformityPoll` above already hold, for the
   * identical reason: `report-<providerId>-<documentId>` names ONE declaration, ever, for this
   * document — re-enqueuing it (a duplicate trigger, a retried "sent" write that never actually
   * doubles up in practice) must never risk a SECOND real submission to a tax authority, unlike an
   * ordinary "send" action job (`enqueueAction`, above), whose retry-by-resend is a deliberate,
   * user-visible feature. Genuine retries of a FAILED declaration attempt already happen at the
   * BullMQ `attempts`/backoff level, inside this SAME job — see `reporting-runner.ts`'s own header.
   *
   * `removeOnComplete: { count: 50 }`, deliberately NOT `true` — found the hard way
   * (`queue/__tests__/document-report-queue.redis.spec.ts`'s own dedup test): a completed report job
   * this fast (a stubbed HTTP round trip finishes in milliseconds) can complete and be REMOVED by
   * BullMQ before a near-simultaneous second `enqueueReport` call ever runs its own `getJob` check,
   * which would otherwise see "nothing exists" and add a genuine SECOND job — a real duplicate
   * declaration to a tax authority. Keeping a capped history of completed report jobs (the same
   * `{ count: 50 }` shape `removeOnFail` already uses) is what makes the "skip unconditionally"
   * guarantee this method's own header describes actually hold once a job has finished, not only
   * while it is still in flight.
   */
  async enqueueReport(data: ReportJobData): Promise<boolean> {
    const jobId = buildReportJobId(data.providerId, data.documentId);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      this.logger.log(`Report ${jobId} already dispatched — not enqueuing a duplicate.`);
      return false;
    }

    const attempts = parseInt(process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS ?? '3', 10);
    await this.queue.add(DOCUMENT_REPORT_JOB_NAME, data as unknown as DocumentActionJobData, {
      jobId,
      attempts,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    });
    this.logger.log(
      `Report ${jobId} enqueued (provider="${data.providerId}", document="${data.documentId}").`,
    );
    return true;
  }
}
