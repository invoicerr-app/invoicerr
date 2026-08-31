/**
 * The Prisma/queue-touching half of the sweep — schedule-sweep.ts holds the pure decisions
 * (`selectDueSchedules`, `buildScheduleOccurrenceJobId`); this class is what actually reads/writes
 * `DocumentSchedule` rows and talks to the queue, on the same "pure core, thin persistence shell"
 * split every other mechanism in this directory already holds (row-selection/, settlement/, ...).
 *
 * Consumed by queue/processors/document-action.processor.ts — the SWEEP repeatable job and every
 * OCCURRENCE job both come off the SAME `Q_DOCUMENT_ACTION` queue that processor already owns, only
 * distinguished by `job.name` (see that file's own header for why this stays one processor, not a
 * second one competing for the same queue).
 */
import { Injectable } from '@nestjs/common';

import { ActionResult } from '../actions/action-registry';
import { DocumentsService } from '../documents.service';
import { findOwnedDocument } from '../persistence';
import { DocumentQueueDispatcher } from '../queue/document-queue.dispatcher';
import { computeNextOccurrence, isScheduleCadence, toUtcMidnight } from './cadence';
import {
  buildScheduleOccurrenceJobId,
  ScheduleOccurrenceJobData,
  selectDueSchedules,
} from './schedule-sweep';
import {
  advanceSchedule,
  DocumentScheduleRecord,
  listDueSchedules,
  recordOccurrenceOutcome,
} from './schedule.persistence';

export interface RunSweepResult {
  /** How many schedules `listDueSchedules` found due — including any this pass's own occurrence
   *  enqueue turned out to be a dedup no-op for (see `enqueued` below). */
  due: number;
  /** How many occurrence jobs were ACTUALLY added to the queue — lower than `due` only when a
   *  concurrent, overlapping sweep pass already dispatched the exact same occurrence first (the
   *  race schedule-sweep.ts's own header describes). */
  enqueued: number;
}

/** `DocumentSchedule.params`, as actually used today: only `thenSend` (invoice-actions.ts's own
 *  chained "send" — see duplicate-extension.ts). Read defensively (a malformed/legacy JSON blob
 *  degrades to "no extra params", never a thrown error mid-sweep). */
function readScheduleParams(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

@Injectable()
export class DocumentScheduleSweepRunner {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly queueDispatcher: DocumentQueueDispatcher,
  ) {}

  /**
   * One sweep pass: every DUE schedule gets exactly one occurrence dispatched, and its own
   * `nextRunAt`/`lastRunAt` are advanced in the SAME pass — deliberately NOT waiting for the
   * occurrence job to actually finish first. This is what makes "one occurrence per schedule per
   * pass" true regardless of how far overdue a schedule is (schedule-sweep.ts's own header on
   * catch-up), and it is safe precisely because `advanceSchedule` only ever touches
   * `nextRunAt`/`lastRunAt`, while the occurrence's own outcome (`recordOccurrenceOutcome`, called
   * from `runOccurrence` below) only ever touches `lastError` — two field-disjoint writes that can
   * land in either order without corrupting one another.
   */
  async runSweep(now: Date = new Date()): Promise<RunSweepResult> {
    const candidates = await listDueSchedules(now);
    // Re-checked against the PURE decision (schedule-sweep.ts) rather than trusting the SQL
    // `WHERE` clause alone to be the single source of truth for "what counts as due" — the same
    // "two independent gates agreeing is what makes either trustworthy" discipline
    // descriptors/lifecycle.ts's own header documents for its own two checks.
    const due = selectDueSchedules(candidates, now);

    let enqueued = 0;
    for (const schedule of due) {
      const occurrenceAt = schedule.nextRunAt;
      const occurrenceIso = occurrenceAt.toISOString();
      const cadence = isScheduleCadence(schedule.cadence) ? schedule.cadence : 'monthly';
      const next = computeNextOccurrence(
        toUtcMidnight(occurrenceAt),
        cadence,
        schedule.anchorDay ?? undefined,
      );

      try {
        // `DocumentsService.runAction` (called from `runOccurrence`, once the worker picks this job
        // up) validates `payload.data` against the ACTING type's OWN descriptor fields BEFORE ever
        // calling the "duplicate" handler — it has no way to know that handler ignores `data` and
        // re-reads the source itself. An EMPTY `data` here would therefore fail that validation with
        // every one of the invoice's own required fields (client, issueDate, ...) reported missing,
        // never even reaching the handler. Fetched fresh HERE (sweep time), not baked in once at
        // schedule-creation time, so an edit to the template document since is honored.
        const sourceDocument = await findOwnedDocument(
          schedule.companyId,
          schedule.typeId,
          schedule.sourceDocumentId,
        );

        const jobId = buildScheduleOccurrenceJobId(schedule.id, occurrenceAt);
        const jobData: ScheduleOccurrenceJobData = {
          scheduleId: schedule.id,
          companyId: schedule.companyId,
          typeId: schedule.typeId,
          documentId: schedule.sourceDocumentId,
          actionId: schedule.actionId,
          occurrenceAt: occurrenceIso,
          payload: {
            data: sourceDocument.data as Record<string, unknown>,
            params: {
              // Schedule-level params (today: `thenSend`) first, `occurrenceDate` LAST so it always
              // wins — this key is this mechanism's own contract with duplicate-extension.ts, never
              // a user-supplied value that should be able to override it.
              ...readScheduleParams(schedule.params),
              occurrenceDate: occurrenceIso,
            },
          },
        };

        if (await this.queueDispatcher.enqueueScheduleOccurrence(jobId, jobData)) enqueued++;
      } catch (error) {
        // The source document is gone (deleted since this schedule was created), or some other
        // failure reading it — there is no occurrence to dispatch at all. Recorded the same way a
        // failed OCCURRENCE would be (see `runOccurrence` below) rather than left silent, and
        // `nextRunAt` still advances below: a permanently-missing source would otherwise wedge this
        // schedule at the same due date forever, retrying every single sweep pass.
        const message = error instanceof Error ? error.message : String(error);
        await recordOccurrenceOutcome(schedule.id, message);
      }

      await advanceSchedule(schedule.id, { nextRunAt: next, lastRunAt: occurrenceAt });
    }

    return { due: due.length, enqueued };
  }

  /**
   * Runs ONE occurrence — through `DocumentsService.runAction`, the SAME entry point the HTTP
   * controller and the ordinary "run" job both use, all four gates included (country policy,
   * status, implementation, validation). THE MUTATION TARGET this method exists to be proof
   * against: calling `ActionRegistry` (or anything else) directly here instead would let a country
   * policy that now forbids "duplicate" run anyway from a schedule — exactly the hole `runAction`
   * exists to close everywhere else in this codebase.
   *
   * On success: clears a stale `lastError` from a PREVIOUS occurrence (see
   * schedule.persistence.ts's own `recordOccurrenceOutcome`). On failure: records the message and
   * RE-THROWS — the occurrence job itself is enqueued with `attempts: 1`
   * (document-queue.dispatcher.ts's `enqueueScheduleOccurrence`), so this is not racing a BullMQ
   * retry of the SAME occurrence; it simply lets BullMQ's own bookkeeping see the failed attempt
   * too (logs, `removeOnFail`), while the schedule's own row is ALREADY the durable, human-visible
   * record of what happened — `enabled` is never touched here, by design (see
   * `DocumentSchedule.enabled`'s own schema comment).
   *
   * ## "then send" — chained HERE, synchronously, never by enqueueing a job from inside this one
   *
   * `params.thenSend` (the invoice case's own opt-in — duplicate-extension.ts declares no such
   * param itself, see that file's header on why) triggers a SECOND `runAction` call, for "send", on
   * whatever document THIS occurrence's own action just produced — called synchronously, right here,
   * the exact same way an HTTP-triggered "Send" click calls it from OUTSIDE any queue job. That
   * "outside any job" part is load-bearing: `runAsyncSendAction`'s own phase-1 (async-send.ts)
   * re-enqueues "send" under its ordinary, deterministic jobId once it flips the record to
   * "sending" — if THIS call were itself already running inside a "send" job (e.g. by enqueueing a
   * job from duplicate-extension.ts and letting the WORKER invoke `runAction('send', ...)` later),
   * that re-enqueue would collide with the job it is itself running inside of (still "active" at
   * that exact moment) and get silently skipped by `DocumentQueueDispatcher.enqueueAction`'s own
   * dedup — wedging the document at "sending" forever, delivered never. Calling `runAction`
   * synchronously from THIS method (which itself runs inside the "duplicate" occurrence's OWN job,
   * a DIFFERENT jobId) sidesteps that entirely: phase-1 runs here, phase-2 gets enqueued fresh (no
   * collision), and the WORKER delivers it moments later — a real bug this file's own live
   * end-to-end test against Mailpit caught before this comment existed.
   *
   * Every gate `runAction` enforces (country policy, status, params, implementation) still applies
   * to "send" here, exactly as it would for a human's click — this is not a shortcut. A "send"
   * failure raised at phase 1 (e.g. no transport configured) is caught by the SAME try/catch as
   * "duplicate" itself and lands on THIS schedule's own `lastError`; a later DELIVERY failure
   * (phase 2, genuinely asynchronous, running in a separate job entirely) surfaces the ordinary way
   * instead — the fresh document's own `lastActionError`/"send_failed" (persistence.ts,
   * queue/mark-send-failed.ts) — NOT reflected back onto the schedule, since by the time it happens
   * this method has already returned. Silently skipped (no error) when the result carries no
   * document, or when `thenSend` isn't set at all — the common case.
   */
  async runOccurrence(data: ScheduleOccurrenceJobData): Promise<ActionResult> {
    try {
      const result = await this.documentsService.runAction(data.companyId, data.typeId, data.actionId, {
        documentId: data.documentId,
        data: data.payload.data,
        params: data.payload.params,
      });

      if (data.payload.params.thenSend === true && result.document) {
        await this.documentsService.runAction(data.companyId, data.typeId, 'send', {
          documentId: result.document.id,
          data: result.document.data as Record<string, unknown>,
          params: {},
        });
      }

      await recordOccurrenceOutcome(data.scheduleId, null);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordOccurrenceOutcome(data.scheduleId, message);
      throw error;
    }
  }
}

/** Re-exported so callers needing only the record shape don't have to reach into
 *  schedule.persistence.ts directly for it. */
export type { DocumentScheduleRecord };
