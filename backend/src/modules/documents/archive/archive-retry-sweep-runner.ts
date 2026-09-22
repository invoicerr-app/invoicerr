/**
 * The Prisma-touching half of the legal archive's retry — `archive-retry-sweep.ts` holds the pure
 * decisions (the cadence, the backoff, the escalation threshold and its wording); this class drives
 * ONE pass and reports what it found. Read that file's header FIRST: it carries why this sweep had to
 * exist at all (the send job's own retry structurally cannot reach the archiving step), and why a row
 * is retried for ever while the SILENCE around it is bounded.
 *
 * Zero constructor dependencies, the same leaf-provider shape `StorageErasureSweepRunner` and
 * `LogPurgeSweepRunner` already have: it calls plain exported functions (`pending-archive.ts`,
 * `persistence.ts`) and `prisma` (a plain singleton default import, never a DI token — this repo's own
 * CLAUDE.md), so it can be listed as a plain provider on whichever module registers the repeatable.
 *
 * ## Where this runs
 *
 * The pass is a QUEUE JOB, registered as one repeatable on the document-action queue
 * (`queue/document-queue.dispatcher.ts`) and consumed by `DocumentActionProcessor` — never a
 * `setInterval` inside each process, for the reason every sweep on that queue shares: BullMQ fires one
 * occurrence cluster-wide and exactly one consumer picks it up, so three replicas still retry a row
 * once per tick rather than three times (and never concurrently with each other, which is what makes
 * "read due rows, attempt them, reschedule them" safe without a lock).
 *
 * ## Failure posture — and how an exhausted failure stays distinguishable from noise
 *
 * A row that fails again is not this PASS failing: it is counted, rescheduled, and left in the
 * journal with its error. So the queue job itself completes normally whenever the sweep did its
 * work, whatever the rows did — a failed job on this queue therefore still means what it always
 * meant. That is deliberate, and it is the same lesson `queue/backup-job-result.ts` records for the
 * backup sweep: a failure that is visible but harmless teaches people to ignore failures.
 *
 * What an operator sees instead is graded:
 *  - one log line per pass, always, so "did it run" is answerable — `warn` as soon as anything is
 *    still pending, `log` when the journal is empty;
 *  - one ERROR-level `Log` row (the persisted, per-company journal the product's own Logs screen
 *    reads), written ONCE per document, the moment its retries cross the escalation threshold and
 *    naming the document — that row is the alert, and it exists only for a gap that has outlived
 *    every transient explanation.
 *
 * A pass reads its due rows before doing anything else; if THAT read fails (the database is down),
 * the error propagates and the job fails, which is honest — nothing was attempted. Everything after
 * it is per-row and caught: one document whose bytes can never be written must not consume anybody
 * else's turn, this pass or any later one.
 */
import { Injectable, Logger } from '@nestjs/common';

import { runWithCompanyId } from '@/lib/request-context';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  buildEscalatedArchiveError,
  readArchiveRetryBatchSize,
  shouldEscalateArchiveRetry,
} from './archive-retry-sweep';
import {
  clearPendingArchive,
  countPendingArchives,
  decodePendingArtifacts,
  DuePendingArchive,
  findDuePendingArchives,
  recordArchiveRetryFailure,
} from './pending-archive';
import { createDocumentArchive } from './persistence';

export interface RunArchiveRetrySweepResult {
  /** Rows this pass actually attempted (bounded — see `readArchiveRetryBatchSize`). */
  attempted: number;
  /** Rows whose artifacts finally made it into a real `DocumentArchive` on this pass. The journal
   *  row is gone and `DocumentInstance.lastArchiveError` is cleared for each of them. */
  archived: number;
  /** Rows that failed again and stay in the journal, rescheduled. */
  failed: number;
  /** Rows that crossed the escalation threshold on THIS pass, for the first time — each one has an
   *  error-level `Log` row of its own naming the document. Normally 0; anything else is the number
   *  worth alerting on. */
  escalated: number;
  /** Documents still delivered-but-unarchived AFTER this pass, counted fresh from the journal rather
   *  than derived from `failed` (which only counts what this bounded pass attempted). `null` when the
   *  count itself could not be read — the pass's own archiving still happened; only this reading of
   *  the backlog did not. */
  pending: number | null;
}

@Injectable()
export class ArchiveRetrySweepRunner {
  private readonly logger = new Logger(ArchiveRetrySweepRunner.name);

  /**
   * One sweep pass: attempt every due row, then look at what is left.
   *
   * `now` is a parameter — never `new Date()` inline — for the same reason every other sweep's own
   * `runSweep(now: Date = new Date())` takes one: a test drives a deterministic clock instead of
   * racing the real one. It decides both which rows are due and what the next deadline of a row that
   * fails again is counted from.
   */
  async runSweep(now: Date = new Date()): Promise<RunArchiveRetrySweepResult> {
    const due = await findDuePendingArchives(now, readArchiveRetryBatchSize());

    let archived = 0;
    let failed = 0;
    let escalated = 0;
    for (const row of due) {
      // Every write below is company-scoped, and this worker has no request of its own to carry a
      // company context (`@/lib/request-context.ts`) — without this, the `Log` row an escalation
      // writes would belong to no company at all and never appear on the screen of the one company
      // whose document is unarchived.
      const outcome = await runWithCompanyId(row.companyId, () => this.retryOne(row, now));
      if (outcome === 'archived') archived += 1;
      else {
        failed += 1;
        if (outcome === 'escalated') escalated += 1;
      }
    }

    const pending = await this.countPending();
    const result: RunArchiveRetrySweepResult = {
      attempted: due.length,
      archived,
      failed,
      escalated,
      pending,
    };

    if (due.length === 0 && pending === 0) {
      this.logger.log('Archive-retry sweep: nothing pending — every delivered document is archived.');
      return result;
    }

    const line =
      `Archive-retry sweep: ${archived} document(s) finally archived, ${failed} still failing ` +
      `(${escalated} escalated on this pass), ` +
      `${pending === null ? 'an unknown number' : pending} delivered but not archived.`;
    if (pending === null || pending > 0) this.logger.warn(line);
    else this.logger.log(line);

    return result;
  }

  /**
   * One row's retry. Returns what happened, never throws: a row that can never succeed (bytes that
   * cannot be decoded, a bucket that is gone for good) consumes its own attempt and nobody else's
   * turn — the same property `drainStorageErasureJournal` holds for the erasure journal, and for the
   * same reason: the head of a due list must never be able to block everything behind it.
   *
   * ⚖ The archive this writes is `createDocumentArchive`'s ordinary one — same hashing, same WORM
   * storage, same retention resolution — with `archivedAt` being NOW rather than the delivery
   * instant. That is honest (the bytes really are preserved only as of now) and safe in the one
   * direction that matters: every rule counted from the document's own `issueDate` is unaffected,
   * and the one counted from `archivedAt` (`retention/schema.ts#RetentionOrigin`) can only land
   * LATER, never earlier than the obligation.
   */
  private async retryOne(row: DuePendingArchive, now: Date): Promise<'archived' | 'failed' | 'escalated'> {
    try {
      const artifacts = decodePendingArtifacts(row.artifacts);
      await createDocumentArchive({ companyId: row.companyId, documentId: row.documentId, artifacts });
      // Order matters: the journal row goes FIRST, so a failure of the `lastArchiveError` clear just
      // below can never leave a row that would be archived a second time on the next pass. The
      // archive itself is already written and durable by this point either way.
      await clearPendingArchive(row.documentId);
      await prisma.documentInstance.update({
        where: { id: row.documentId },
        data: { lastArchiveError: null },
      });
      this.logger.log(
        `Archived ${row.typeId}/${row.documentId} on retry ${row.attempts + 1} — the gap that opened ` +
          `at ${row.firstFailedAt.toISOString()} is closed.`,
      );
      return 'archived';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.recordFailure(row, message, now);
    }
  }

  /**
   * Books one more failed attempt and decides whether this is the pass that has to tell a human.
   *
   * Wrapped whole: if even the bookkeeping fails (the database is unreachable too), the row keeps
   * the deadline it already had and the next pass picks it up again — the artifact is still in the
   * journal, which is the only thing that must never be lost here.
   */
  private async recordFailure(
    row: DuePendingArchive,
    message: string,
    now: Date,
  ): Promise<'failed' | 'escalated'> {
    try {
      const failure = await recordArchiveRetryFailure({
        id: row.id,
        attempts: row.attempts,
        alreadyEscalated: row.escalatedAt !== null,
        escalate: shouldEscalateArchiveRetry(row.attempts + 1),
        error: message,
        now,
      });

      // Until a row escalates, the document carries the raw driver message: honest, current, and
      // quiet — the archive store hiccuped and a retry is already scheduled. Once it escalates, that
      // same field is rewritten into a sentence that states the fact a company has to act on, and
      // stays that way (every later failure keeps re-writing the escalated wording, never falling
      // back to the bare message).
      const escalatedText =
        failure.escalatedNow || row.escalatedAt !== null
          ? buildEscalatedArchiveError({
              displayNumber: row.displayNumber,
              attempts: failure.attempts,
              firstFailedAt: row.firstFailedAt,
              lastError: message,
            })
          : message;
      await prisma.documentInstance.update({
        where: { id: row.documentId },
        data: { lastArchiveError: escalatedText },
      });

      if (failure.escalatedNow) {
        // THE alert — ONE persisted, company-scoped `Log` row per document, ever. Error level, and
        // named: an archive missing for a delivered document is a legal obligation unmet (⚖ the
        // retention catalogue's own durations), not a job that can be retried out of sight.
        logger.error('Legal archiving still failing for a delivered document — it has NO archive', {
          category: 'documents',
          // Passed explicitly rather than inherited from the ambient context (see `LogOptions.
          // companyId`'s own header): one pass legitimately spans SEVERAL companies' rows, so the
          // company this line is about is a per-row fact, not the process's.
          companyId: row.companyId,
          details: {
            companyId: row.companyId,
            documentId: row.documentId,
            typeId: row.typeId,
            displayNumber: row.displayNumber,
            attempts: failure.attempts,
            firstFailedAt: row.firstFailedAt.toISOString(),
            message,
          },
        });
        this.logger.error(
          `Archiving ${row.typeId}/${row.documentId}` +
            `${row.displayNumber ? ` (${row.displayNumber})` : ''} has failed ${failure.attempts} ` +
            `times since ${row.firstFailedAt.toISOString()} — the document is delivered and NOT ` +
            `archived. Retries continue: ${message}`,
        );
        return 'escalated';
      }

      this.logger.warn(
        `Archiving ${row.typeId}/${row.documentId} failed again (attempt ${failure.attempts}) — ` +
          `rescheduled: ${message}`,
      );
      return 'failed';
    } catch (bookkeepingError) {
      this.logger.error(
        `Could not even record the failed archive retry for ${row.typeId}/${row.documentId} — the ` +
          `artifacts stay journaled and the next pass will try again. Archiving failure: ${message}; ` +
          `bookkeeping failure: ` +
          `${bookkeepingError instanceof Error ? bookkeepingError.message : String(bookkeepingError)}`,
      );
      return 'failed';
    }
  }

  /**
   * How many documents are still delivered-but-unarchived once this pass has had its turn.
   * Deliberately a fresh count rather than arithmetic on this pass's own numbers: the pass is
   * bounded (`readArchiveRetryBatchSize`), so `failed` says nothing about the rows it never reached,
   * and a backlog an operator cannot see is exactly the state this whole mechanism exists to end.
   *
   * Never throws: the archives this pass wrote are already durable, so a failure to READ the
   * remainder must not report the pass as failed. Reported as `null`, which the log line above
   * treats as loudly as a non-zero count.
   */
  private async countPending(): Promise<number | null> {
    try {
      return await countPendingArchives();
    } catch (error) {
      this.logger.error(
        'Archive-retry sweep could not read what is still pending — the archives this pass wrote ' +
          `still stand: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
