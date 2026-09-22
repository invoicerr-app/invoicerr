/**
 * The Prisma-touching half of the storage-erasure sweep — `storage-erasure-sweep.ts` holds the pure
 * decisions (the cadence, the job constants); this class drives ONE pass and reports what it found.
 *
 * Zero constructor dependencies, the same leaf-provider shape `CurrencyRateSweepRunner` and
 * `LogPurgeSweepRunner` already have (`queue/document-queue-worker.module.ts`'s own header): it calls
 * `drainStorageErasureJournal` (a plain exported function) and `prisma` (a plain singleton default
 * import, never a DI token — this repo's own CLAUDE.md), so it can be listed as a plain provider on
 * whichever module registers the repeatable, with nothing else to import to reach it.
 *
 * ## Where this runs, and why it is not a timer in the API process
 * The pass is a QUEUE JOB, registered as one repeatable on the document-action queue
 * (`queue/document-queue.dispatcher.ts`) and consumed by `DocumentActionProcessor` — never a
 * `setInterval`/`onApplicationBootstrap` loop inside each process. That is what makes the cadence a
 * property of the DEPLOYMENT rather than of how many replicas happen to be running: BullMQ fires one
 * occurrence of a repeatable cluster-wide and exactly one consumer picks it up, so three API replicas
 * still drain the journal once a day, not three times. Registration itself runs on every boot and is
 * deduped by the repeat key, which is why every process that imports the worker module can safely
 * register without coordinating. The runner is therefore provided by the module that carries the
 * PROCESSOR (`DocumentsQueueWorkerModule`), the one module a dedicated `ROLE=worker` process imports
 * and the API imports only when `WORKER_INLINE` is not `false` — the same placement every other
 * cross-cutting sweep on this queue already has.
 *
 * ## Failure posture — and why one stuck object cannot starve the rest
 * `drainStorageErasureJournal` NEVER THROWS, deliberately (see its own header): a row whose object
 * delete failed is counted in `failed`, left pending with its `lastError` written down, and attempted
 * again by the next pass. So a pass has no failure of its own to propagate and this method wraps it in
 * no try/catch — there is nothing to catch.
 *
 * That same posture is what keeps ONE permanently-failing object — a bucket whose credentials are
 * gone, a volume that never comes back — from blocking every other row behind it: the drain reads the
 * WHOLE pending set (no batch cap, no cursor, no ordering to get stuck at the head of) and attempts
 * every due row inside its own try/catch, so a row that can never succeed consumes its own attempt and
 * nobody else's turn, on this pass or any later one. It is retried for ever, which is the honest
 * outcome — the bytes really are still there — at a cost of one failing delete call per day.
 *
 * At the BullMQ level the job is registered `attempts: 1`, like every sibling sweep: a pass that
 * somehow did throw is not retried moments later, because the next tick one interval away is already
 * the retry — and for a boundary measured in years, a day's delay is not even one.
 *
 * ## What an operator can see
 * One line per pass, always, so "did it run at all" is answerable from the log alone; the LEVEL
 * carries the answer to "is anything overdue and stuck" — `warn` as soon as `failed` or `stuck` is
 * non-zero, `log` otherwise. `retained` never raises the level: bytes a statute still requires kept are
 * the mechanism working (⚖ `company-storage-erasure.ts`'s own header), not a backlog, and the drain
 * already emits its own warning naming the statute when it holds any.
 *
 * Two numbers here would be worth a gauge the day this codebase grows a metrics exporter, and neither
 * needs any change to this class to become one: `stuck` (alert when it stays above zero across several
 * passes — that is exactly "bytes we promised to erase are still on storage") and `retained` (how much
 * the product is holding on statutory grounds at any moment). `erased` as a counter would show the
 * discharge rate. Nothing emits a metric today; the log line is the whole interface.
 */
import { Injectable, Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { drainStorageErasureJournal } from './company-storage-erasure';

export interface RunStorageErasureSweepResult {
  /** Objects actually deleted from storage on this pass. */
  erased: number;
  /** Rows deliberately left pending because a statute still requires those bytes kept — ⚖ never a
   *  failure, and never logged as one. */
  retained: number;
  /** Rows whose deletion threw on THIS pass. They stay pending with `lastError` set; the next pass
   *  attempts them again. */
  failed: number;
  /** Rows still pending AFTER this pass whose retention has elapsed (or never existed) — the "is
   *  anything overdue and stuck" number, counted fresh from the journal rather than derived from
   *  `failed`. `null` when the count itself could not be read (the pass's own erasures still happened;
   *  only this reading of the backlog did not). */
  stuck: number | null;
}

@Injectable()
export class StorageErasureSweepRunner {
  private readonly logger = new Logger(StorageErasureSweepRunner.name);

  /**
   * One sweep pass: drain everything the journal says is due, then look at what is left.
   *
   * `now` is a parameter — never `new Date()` inline — for the same reason every other sweep's own
   * `runSweep(now: Date = new Date())` takes one: a test drives a deterministic clock instead of
   * racing the real one. It is threaded into the drain, where it decides BOTH which rows are past
   * their retention and what instant a successfully erased row records as its `erasedAt`.
   */
  async runSweep(now: Date = new Date()): Promise<RunStorageErasureSweepResult> {
    const drained = await drainStorageErasureJournal({ now });
    const stuck = await this.countOverdueStillPending(now);
    const result: RunStorageErasureSweepResult = { ...drained, stuck };

    if (drained.erased === 0 && drained.retained === 0 && drained.failed === 0 && stuck === 0) {
      this.logger.log(
        'Storage-erasure sweep: nothing due — no journal row names bytes that are still on storage.',
      );
      return result;
    }

    const line =
      `Storage-erasure sweep: ${drained.erased} object(s) erased, ` +
      `${drained.retained} kept by a statute, ${drained.failed} failed this pass, ` +
      `${stuck === null ? 'an unknown number' : stuck} overdue and still on storage.`;
    if (drained.failed > 0 || stuck === null || stuck > 0) this.logger.warn(line);
    else this.logger.log(line);

    return result;
  }

  /**
   * How many journal rows are STILL pending and no longer held by any statute, read after the drain
   * has had its turn. Deliberately a fresh count rather than arithmetic on the drain's own result:
   * `failed` only counts rows this pass actually ATTEMPTED, so a journal read that itself failed (the
   * drain logs that and returns all zeros — see its own header) would otherwise be indistinguishable
   * from an empty journal, which is the one confusion an operator must never be led into by this line.
   *
   * A company deleted between the drain and this count is counted here although its own inline drain
   * is about to erase it moments later — a one-pass overcount that corrects itself on the next tick,
   * and the harmless direction to be wrong in for a number whose whole job is to be noticed.
   *
   * Never throws: the erasures this pass performed are already done and already durable, so a failure
   * to READ the remaining backlog must not report the pass as failed. Reported as `stuck: null`, which
   * the log line above treats as loudly as a non-zero count.
   */
  private async countOverdueStillPending(now: Date): Promise<number | null> {
    try {
      return await prisma.pendingStorageErasure.count({
        where: {
          erasedAt: null,
          // The exact complement of the drain's own "still retained" test: no declared retention at
          // all, or one whose date has passed. Served by the existing `@@index([erasedAt])`
          // (schema.prisma) — the same index an operator's own "what is still on disk?" query uses.
          OR: [{ retentionUntil: null }, { retentionUntil: { lte: now } }],
        },
      });
    } catch (error) {
      this.logger.error(
        'Storage-erasure sweep could not read what is still pending — the erasures this pass made ' +
          `still stand: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
