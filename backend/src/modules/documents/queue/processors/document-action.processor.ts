/**
 * The document-action queue's ONLY processor — one generic worker for every declared action, not one
 * processor per business need (TODO.md item 22: "un mécanisme générique, pas un job ad hoc"). Lives in
 * its OWN module (document-queue-worker.module.ts), gated by WORKER_INLINE, so a scaled deployment can
 * run it in a dedicated process without the API also consuming (see that module's own header).
 *
 * `process()` replays the job through `DocumentsService.runAction` — the EXACT SAME entry point the
 * HTTP controller calls (documents.controller.ts) — never a shortcut straight to `ActionRegistry`.
 * THIS is what makes "an action forbidden by the country policy must be refused in the worker too"
 * true by construction: `runAction` is where all four gates live (country policy 403, status 409,
 * implementation 501, data validation 400), and this processor has no other way to run an action.
 * Mutating this call to bypass `runAction` (e.g. calling the registry directly) is exactly THE
 * MUTATION TARGET #1 this task's own instructions ask to prove against — see
 * document-action.processor.spec.ts.
 *
 * ## Root TODO item 5 (recurring documents) — TWO more job names, same queue, same class
 *
 * `Q_DOCUMENT_ACTION` also carries the ONE sweep repeatable
 * (schedules/schedule-sweep.ts's `SCHEDULE_SWEEP_JOB_NAME`) and every OCCURRENCE job it dispatches
 * (`SCHEDULE_OCCURRENCE_JOB_NAME`) — "never a second queue" (queue.constants.ts's own header). BullMQ
 * gives a queue exactly ONE consuming `Worker`; a SECOND `@Processor(Q_DOCUMENT_ACTION)` class would
 * not partition jobs by name, it would just compete with this one for EVERY job, including ordinary
 * "run" ones — so branching on `job.name`, right here, is the only safe way to add these two without
 * risking an ordinary action job landing on code that doesn't expect its shape. The pre-existing "run"
 * branch below is untouched by this addition — same lines, same behavior, same tests.
 *
 * `sweepRunner` is `@Optional()`: every EXISTING spec in this file (and the real Redis integration
 * spec, queue/__tests__/document-action-queue.redis.spec.ts) constructs this processor with only a
 * `DocumentsService` and never sends a schedule-named job — Nest injects `undefined` for an omitted
 * optional dependency rather than throwing, so none of that had to change for this task. Production
 * wiring (documents-core.module.ts) always provides a real one.
 */
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { ActionResult } from '../../actions/action-registry';
import { DocumentsService } from '../../documents.service';
import { DocumentScheduleSweepRunner, RunSweepResult } from '../../schedules/schedule-sweep-runner';
import {
  SCHEDULE_OCCURRENCE_JOB_NAME,
  SCHEDULE_SWEEP_JOB_NAME,
  ScheduleOccurrenceJobData,
} from '../../schedules/schedule-sweep';
import { markSendFailed } from '../mark-send-failed';
import { DocumentActionJobData, Q_DOCUMENT_ACTION } from '../queue.constants';

@Processor(Q_DOCUMENT_ACTION)
export class DocumentActionProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentActionProcessor.name);

  constructor(
    private readonly documentsService: DocumentsService,
    @Optional() private readonly sweepRunner?: DocumentScheduleSweepRunner,
  ) {
    super();
  }

  async process(job: Job<DocumentActionJobData>): Promise<ActionResult | RunSweepResult> {
    if (job.name === SCHEDULE_SWEEP_JOB_NAME) {
      this.logger.log(`Running the document-schedule sweep (job ${job.id})`);
      return this.requireSweepRunner().runSweep();
    }

    if (job.name === SCHEDULE_OCCURRENCE_JOB_NAME) {
      const occurrence = job.data as unknown as ScheduleOccurrenceJobData;
      this.logger.log(
        `Running scheduled occurrence for schedule ${occurrence.scheduleId} ` +
          `(${occurrence.typeId}/${occurrence.actionId}, job ${job.id})`,
      );
      return this.requireSweepRunner().runOccurrence(occurrence);
    }

    const { companyId, typeId, documentId, actionId, payload } = job.data;
    this.logger.log(`Running "${actionId}" on ${typeId}/${documentId} (job ${job.id}, company ${companyId})`);

    // No try/catch here: a thrown error (a forbidden action, a transient delivery failure inside the
    // action's own handler, ...) must propagate so BullMQ records this ATTEMPT as failed and applies
    // its own retry/backoff — swallowing it here would silently turn every failure into a single,
    // un-retried attempt. THE MUTATION TARGET #2 ("l'échec du job persiste sent quand même") lives in
    // the action handler itself (actions/async-send.ts) and in `onFailed` below, not in this method.
    return this.documentsService.runAction(companyId, typeId, actionId, {
      documentId,
      data: payload.data,
      params: payload.params,
    });
  }

  private requireSweepRunner(): DocumentScheduleSweepRunner {
    if (!this.sweepRunner) {
      // Unreachable in production (documents-core.module.ts always provides one) — a loud, named
      // failure rather than a silent no-op if this is ever wired without it.
      throw new Error(
        'DocumentActionProcessor received a schedule job but has no DocumentScheduleSweepRunner.',
      );
    }
    return this.sweepRunner;
  }

  /**
   * Fires after EVERY failed attempt, not only the last one — `job.attemptsMade` (already
   * incremented for this attempt by BullMQ before the event fires) compared against the job's own
   * configured `attempts` (document-queue.dispatcher.ts) is what tells "one more retry is coming"
   * apart from "this was the terminal failure". Only the terminal case calls `markSendFailed` — an
   * earlier attempt failing is exactly what BullMQ's backoff is FOR, not something this record's
   * status should reflect yet (it stays "sending" through every retry).
   *
   * Schedule-named jobs (sweep/occurrence) are explicitly skipped here: an occurrence's own failure
   * is ALREADY recorded, on every attempt, by `DocumentScheduleSweepRunner.runOccurrence` itself
   * (schedule-sweep-runner.ts) — `markSendFailed` targets a "send" action's own document/status
   * vocabulary, which an occurrence job's `documentId` (the schedule's SOURCE document, not
   * necessarily the one the action even changes) does not share, and calling it would be a harmless
   * but confusing no-op at best.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<DocumentActionJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    if (job.name === SCHEDULE_SWEEP_JOB_NAME || job.name === SCHEDULE_OCCURRENCE_JOB_NAME) return;

    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}) — BullMQ will retry: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `Job ${job.id} failed permanently after ${job.attemptsMade} attempt(s): ${error.message}`,
    );
    const { companyId, typeId, documentId, actionId } = job.data;
    await markSendFailed((id) => this.documentsService.getType(id), {
      companyId,
      typeId,
      documentId,
      actionId,
      error,
    });
  }
}
