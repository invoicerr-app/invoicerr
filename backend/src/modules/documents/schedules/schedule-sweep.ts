/**
 * The SWEEP's own pure decisions — deliberately split from schedule-sweep-runner.ts (the Prisma/
 * BullMQ-touching half) the same way row-selection/resolve-row-selection.ts is split from its own
 * DB-touching caller: "which schedules are due" and "what job id does THIS occurrence get" are both
 * plain functions of data already in hand, so they are testable without a broker or a database
 * (schedule-sweep.spec.ts).
 *
 * ## ONE sweep, not one repeatable job per schedule
 *
 * A naive design would register a BullMQ repeatable per `DocumentSchedule` row (its own cadence as
 * the repeat interval). This module deliberately does not do that: a repeatable per schedule means
 * registering/unregistering one every time a schedule is created, edited, or deleted — a second,
 * parallel bookkeeping problem alongside the `DocumentSchedule` table itself, and one BullMQ's own
 * `every`-based repeat cannot even express faithfully for "monthly" (real months are not a fixed
 * number of milliseconds; `computeNextOccurrence`'s own clamp is precisely why). Instead there is
 * exactly ONE repeatable job (`schedule-sweep-runner.ts` registers it, on a fixed
 * `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS` interval, default 60s) that PERIODICALLY asks this module
 * "which rows are due right now" — the schedules table itself is the only durable state, the
 * repeatable is just a metronome.
 *
 * ## Catch-up: ONE occurrence per schedule, per sweep pass — never a silent burst
 *
 * `selectDueSchedules` returns every schedule whose `nextRunAt` has passed, however far behind it
 * is — a schedule that missed three months while the worker was down is still just ONE row here,
 * once. It is the CALLER (schedule-sweep-runner.ts's `runSweep`) that enforces "one occurrence per
 * schedule per pass": it enqueues exactly one occurrence and advances `nextRunAt` by exactly one
 * `computeNextOccurrence` step, never a `while (nextRunAt <= now)` loop that would fire the whole
 * backlog in one call. Concretely, a monthly invoice three cycles late still catches up — but at one
 * sweep-interval's pace (one occurrence roughly every `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS`), not
 * three duplicate invoices landing in the same instant nobody asked for.
 *
 * This is a DELIBERATE, debatable trade-off: at the default 60s interval, a three-month backlog
 * still finishes catching up in three minutes with no human in the loop at any point — throttled,
 * not silent, but still fully automatic. TODO_ISSUES.md records this as worth reconsidering (e.g. a
 * schedule that finds itself more than one cadence step behind could instead surface a "catch-up
 * pending, confirm?" state) rather than deciding it unilaterally here.
 *
 * ## The occurrence jobId: what actually makes "two overlapping sweeps -> one occurrence" true
 *
 * In the ORDINARY case, this guarantee costs nothing: sweep pass #2 simply won't re-select a schedule
 * whose `nextRunAt` sweep pass #1 already advanced past "now" (see schedule-sweep-runner.ts's own
 * header for why `nextRunAt`/`lastRunAt` are written as part of the SAME pass that enqueues, not
 * after the occurrence job finishes). The jobId below is what covers the one race that ordering
 * cannot: two sweep passes reading the SAME stale `nextRunAt` before either has written its own
 * advance (a sweep pass overlapping the next one, e.g. because the previous pass was still working
 * through a large batch). Both passes then compute the exact same `occurrenceAt`, so
 * `buildScheduleOccurrenceJobId` produces the exact same id for both. `enqueueScheduleOccurrence`'s
 * own pre-check (queue/document-queue.dispatcher.ts) usually turns the SECOND caller's attempt into
 * a visible no-op — but under GENUINELY concurrent calls that pre-check itself can race (it is two
 * separate Redis round trips), so the guarantee that actually holds even then is BullMQ's OWN jobId
 * idempotency: `Queue.add()` given an id that already exists never creates a SECOND, independent job
 * — it resolves to the existing one. Proven directly against a real Redis by
 * queue/__tests__/document-schedule-queue.redis.spec.ts's own "racing" test (two genuinely
 * concurrent sweep calls, exactly one resulting document, regardless of what each call's own return
 * value claimed). This is deliberately NOT `buildDocumentActionJobId`'s own "clear a terminal job and
 * re-add" behavior (document-action-job.ts): retrying the SAME occurrence is never a legitimate
 * operation for a schedule — a genuine retry happens at the NEXT occurrence's own, differently-dated
 * id, which is exactly what `lastError` (left in place, `enabled` untouched) waits for.
 */
import { ScheduleCadence } from './cadence';

export interface ScheduleRow {
  id: string;
  enabled: boolean;
  nextRunAt: Date;
}

/** Every schedule whose own `nextRunAt` is due at `now` — `enabled` ones only; a disabled schedule
 *  is invisible to the sweep entirely; see `DocumentSchedule.enabled`'s own schema comment for why
 *  disabling is the ONLY thing that ever removes a schedule from consideration, never an occurrence
 *  failure by itself. */
export function selectDueSchedules<T extends ScheduleRow>(schedules: T[], now: Date): T[] {
  return schedules.filter((schedule) => schedule.enabled && schedule.nextRunAt.getTime() <= now.getTime());
}

/**
 * The occurrence's own deterministic id — `schedule-<scheduleId>-<occurrenceAt epoch ms>`. Epoch
 * milliseconds rather than an ISO string (the task's own "or equivalent"): an ISO calendar-day
 * string itself contains dashes (`2026-08-31T00:00:00.000Z`), which would make a naive
 * split-on-`-` reconstruction of `scheduleId` ambiguous the moment a cuid ever happened to contain
 * one — a plain integer suffix has no such collision with the separator, and is exactly as unique
 * and exactly as deterministic per (schedule, occurrence) pair. Never `:` — see
 * document-action-job.ts's own header on why BullMQ reserves that character for its OWN repeatable
 * job ids.
 */
export function buildScheduleOccurrenceJobId(scheduleId: string, occurrenceAt: Date): string {
  return `schedule-${scheduleId}-${occurrenceAt.getTime()}`;
}

/** The ONE repeatable job's own identity — a plain constant, never derived from anything per-schedule
 *  (there is exactly one sweep, see this file's header). */
export const SCHEDULE_SWEEP_JOB_NAME = 'document-schedule-sweep';
export const SCHEDULE_SWEEP_JOB_ID = 'document-schedule-sweep-singleton';

/** The occurrence job's own name — distinct from the ordinary `'run'` job name
 *  (document-queue.dispatcher.ts) so `DocumentActionProcessor.process()` can tell "replay this action
 *  for an API/UI-driven call" apart from "this is a scheduled occurrence, whose outcome must be
 *  reflected on the DocumentSchedule row, not (only) on the acted-upon document". */
export const SCHEDULE_OCCURRENCE_JOB_NAME = 'document-schedule-occurrence';

export function readSweepIntervalMs(): number {
  return parseInt(process.env.DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS ?? '60000', 10);
}

/**
 * One occurrence job's data — deliberately shaped like `DocumentActionJobData`
 * (queue/queue.constants.ts: companyId/typeId/documentId/actionId/payload), plus the two fields an
 * ordinary action job never needs: `scheduleId` (so the outcome can be written back onto the RIGHT
 * `DocumentSchedule` row — see schedule-sweep-runner.ts's own `runOccurrence`) and `occurrenceAt`
 * (kept for logging/diagnostics; the actual date recalculation already happened when
 * `payload.params.occurrenceDate` was filled in, at enqueue time — see schedule-sweep-runner.ts).
 * `documentId` here is always the schedule's own `sourceDocumentId` — "duplicate" reads it, and
 * writes a BRAND NEW record, never this one.
 */
export interface ScheduleOccurrenceJobData {
  scheduleId: string;
  companyId: string;
  typeId: string;
  documentId: string;
  actionId: string;
  occurrenceAt: string;
  payload: { data: Record<string, unknown>; params: Record<string, unknown> };
}

/** Re-exported for callers that only need the cadence type, so they don't have to import from two
 *  different files for "a schedule's cadence" and "the sweep's own vocabulary". */
export type { ScheduleCadence };
