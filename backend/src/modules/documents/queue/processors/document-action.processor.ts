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
import {
  CONFORMITY_POLL_JOB_NAME,
  CONFORMITY_SWEEP_JOB_NAME,
  ConformityPollJobData,
} from '../../conformity/conformity-sweep';
import { ConformitySweepRunner, RunConformitySweepResult } from '../../conformity/conformity-sweep-runner';
import { DocumentsService } from '../../documents.service';
import { DOCUMENT_REPORT_JOB_NAME, ReportJobData } from '../../reporting/report-job';
import { ReportingRunner } from '../../reporting/reporting-runner';
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
    // Same `@Optional()` reasoning as `sweepRunner` above — every EXISTING spec in this file (and
    // the ordinary-action real-Redis integration spec) constructs this processor without one and
    // never sends a conformity-named job; production wiring (documents-core.module.ts) always
    // provides a real one.
    @Optional() private readonly conformitySweepRunner?: ConformitySweepRunner,
    // Same `@Optional()` reasoning again — declarative reporting (root TODO, `reporting/`) is a
    // ONE-SHOT job, not a repeatable sweep, but the shape is identical: every EXISTING spec in this
    // file constructs this processor without one and never sends a report-named job; production
    // wiring (documents-core.module.ts) always provides a real one.
    @Optional() private readonly reportingRunner?: ReportingRunner,
  ) {
    super();
  }

  async process(
    job: Job<DocumentActionJobData>,
  ): Promise<ActionResult | RunSweepResult | RunConformitySweepResult | { journaled: number }> {
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

    if (job.name === CONFORMITY_SWEEP_JOB_NAME) {
      this.logger.log(`Running the document-conformity sweep (job ${job.id})`);
      return this.requireConformitySweepRunner().runSweep();
    }

    if (job.name === CONFORMITY_POLL_JOB_NAME) {
      const poll = job.data as unknown as ConformityPollJobData;
      this.logger.log(
        `Running conformity poll for document ${poll.documentId} ("${poll.providerId}", job ${job.id})`,
      );
      return this.requireConformitySweepRunner().runPoll(poll);
    }

    if (job.name === DOCUMENT_REPORT_JOB_NAME) {
      const report = job.data as unknown as ReportJobData;
      this.logger.log(
        `Running declarative report for document ${report.documentId} ("${report.providerId}", job ${job.id})`,
      );
      // No try/catch here, deliberately — see `reporting-runner.ts#runReport`'s own header: it
      // handles `ChannelNotConnectedError` inline (journals `report:blocked`, never retried) but
      // lets any OTHER failure propagate, exactly like the ordinary "run" branch below, so BullMQ's
      // own `attempts`/backoff (`DocumentQueueDispatcher.enqueueReport`) gets to run. Only once every
      // retry is exhausted does `onFailed` below journal `report:failed`.
      return this.requireReportingRunner().runReport(report);
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

  private requireConformitySweepRunner(): ConformitySweepRunner {
    if (!this.conformitySweepRunner) {
      // Unreachable in production (documents-core.module.ts always provides one) — a loud, named
      // failure rather than a silent no-op if this is ever wired without it.
      throw new Error('DocumentActionProcessor received a conformity job but has no ConformitySweepRunner.');
    }
    return this.conformitySweepRunner;
  }

  private requireReportingRunner(): ReportingRunner {
    if (!this.reportingRunner) {
      // Unreachable in production (documents-core.module.ts always provides one) — a loud, named
      // failure rather than a silent no-op if this is ever wired without it.
      throw new Error('DocumentActionProcessor received a report job but has no ReportingRunner.');
    }
    return this.reportingRunner;
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

    // A report job's own vocabulary is neither a "send" action's (no `actionId` at all — see
    // `ReportJobData`) nor a schedule/conformity job's (which, unlike a report, is either skipped
    // entirely below or never reaches `onFailed` in the first place): a dedicated branch, run BEFORE
    // the generic skip-list, terminal-only (an earlier, still-retryable attempt is exactly what
    // BullMQ's own backoff is for — the SAME "attemptsMade < attempts, log and return" gate every
    // other branch here already applies). `recordTerminalFailure` never throws on its own (see its
    // own header) — this try/catch is the second, unconditional belt, the identical discipline this
    // method's own header already documents for `markSendFailed` below (a listener that throws kills
    // the whole worker process).
    if (job.name === DOCUMENT_REPORT_JOB_NAME) {
      const attempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        this.logger.warn(
          `Report job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}) — BullMQ will retry: ${error.message}`,
        );
        return;
      }
      try {
        await this.requireReportingRunner().recordTerminalFailure(
          job.data as unknown as ReportJobData,
          error,
        );
      } catch (recordError) {
        this.logger.error(
          `recordTerminalFailure itself failed for report job ${job.id} — original failure: ` +
            `${error.message}; recording failure: ` +
            `${recordError instanceof Error ? recordError.message : String(recordError)}`,
        );
      }
      return;
    }

    if (
      job.name === SCHEDULE_SWEEP_JOB_NAME ||
      job.name === SCHEDULE_OCCURRENCE_JOB_NAME ||
      // Same reasoning — a conformity job's `documentId`/outcome vocabulary is not a "send" action's,
      // and `runPoll` itself never throws in the first place (it journals `poll:blocked` instead —
      // see conformity-sweep-runner.ts's own header), so reaching this branch for one at all would
      // already mean something unexpected happened above `runPoll`'s own try/catch.
      job.name === CONFORMITY_SWEEP_JOB_NAME ||
      job.name === CONFORMITY_POLL_JOB_NAME
    )
      return;

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
    // `@OnWorkerEvent` handlers are event listeners, not a BullMQ-retried job attempt: anything they
    // throw becomes an UNHANDLED REJECTION, which kills the entire Node process — this is not
    // theoretical, it is exactly what happened here twice on 2026-08-31 (a document deleted while its
    // failed send's terminal-failure job was still in flight took down two whole e2e backends).
    // `markSendFailed` already has its own belt for the specific "document no longer exists" case
    // (mark-send-failed.ts), but this try/catch is the second, unconditional one: whatever reason
    // markSendFailed might still fail for, this handler must never let it escape — log every bit of
    // context (both the original job failure and this marking failure) and stop, never rethrow.
    try {
      await markSendFailed((id) => this.documentsService.getType(id), {
        companyId,
        typeId,
        documentId,
        actionId,
        error,
      });
    } catch (markError) {
      this.logger.error(
        `markSendFailed itself failed for job ${job.id} (${typeId}/${documentId}, action "${actionId}") — ` +
          `original failure: ${error.message}; marking failure: ` +
          `${markError instanceof Error ? markError.message : String(markError)}`,
      );
    }
  }
}
