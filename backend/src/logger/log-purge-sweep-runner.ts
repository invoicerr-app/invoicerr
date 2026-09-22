/**
 * The Prisma-touching half of the `Log` purge sweep — `log-purge-sweep.ts` holds the pure decisions
 * (retention/cutoff/batch-size, the job constants); this class is what actually reads and deletes
 * `Log` rows, the same "pure core, thin persistence shell" split every other sweep in this codebase
 * already holds for its own mechanism (see that file's own header).
 *
 * Zero constructor dependencies, the same `CurrencyRateSweepRunner`/`ReminderSweepRunner`-style leaf
 * provider shape (`document-queue-worker.module.ts`'s own header): this class talks to `prisma` (a
 * plain singleton default import, never a DI token — this repo's own CLAUDE.md) and to nothing else,
 * so it can be listed as a plain provider on whichever module registers the repeatable, with no import
 * of `LoggerModule` required by that module just to reach it.
 *
 * ## The two Prisma queries this sweep issues, and the indexes that already serve them
 * 1. Discovery — `findMany({ where: { timestamp: { lt: cutoff } }, distinct: ['companyId'] })`: every
 *    DISTINCT `companyId` (including `null`, the instance-level bucket — see `Log.companyId`'s own
 *    schema comment) that has at least one row past the cutoff. Served by the existing
 *    `@@index([timestamp])` — a plain range scan on the cutoff, exactly what that index is for.
 * 2. Per-company batch — `findMany({ where: { companyId, timestamp: { lt: cutoff } }, orderBy:
 *    { timestamp: 'asc' }, take: LOG_PURGE_BATCH_SIZE })`: served by the existing
 *    `@@index([companyId, timestamp])` — the SAME composite index `modules/logger/logger.controller.ts
 *    #streamLogs`'s own company-scoped, timestamp-ordered read already relies on (that index's own
 *    schema comment). An equality on the leading column plus a range+ORDER BY on the second is exactly
 *    what a btree composite index is for; Postgres groups `NULL` companyId rows together in the same
 *    index just like any other value, so the instance-level bucket is served by it too. NEITHER query
 *    needed a new index — this sweep's own predicate shape was chosen to match what the logs screen
 *    already required.
 *
 * Deleting is a SEPARATE `deleteMany({ where: { id: { in: ids } } })` from the ids the batch query just
 * selected — Prisma's `deleteMany` has no `take`/`orderBy` of its own, so a delete that must be both
 * BOUNDED (see `log-purge-sweep.ts`'s own header on why one statement must never touch the whole
 * backlog) and OLDEST-FIRST needs the select-then-delete-by-id shape, not a single statement.
 */
import { Injectable, Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import {
  computeLogPurgeCutoff,
  isLogPurgeEnabled,
  LOG_PURGE_BATCH_SIZE,
  readLogRetentionDays,
} from './log-purge-sweep';

export interface RunLogPurgeSweepResult {
  /** `false` only when `LOG_RETENTION_DAYS` is `0` or negative — the explicit "keep everything"
   *  escape hatch (`isLogPurgeEnabled`). Every other field is `0` in that case: nothing was looked at
   *  at all, not "looked at and found nothing". */
  enabled: boolean;
  /** How many DISTINCT `companyId` values (including the instance-level `null` bucket, if it itself
   *  had at least one expired row this pass) had at least one row past the cutoff — never the total
   *  number of `Company` rows in the system, and never assumed to still resolve to a live company (an
   *  orphaned `companyId` from a permanently-deleted company is exactly as eligible as a live one). */
  companiesProcessed: number;
  /** How many `Log` rows this pass actually deleted, summed across every company's own bounded batch.
   *  Can be LESS than a company's true expired backlog when that backlog exceeds
   *  `LOG_PURGE_BATCH_SIZE` — the remainder simply reappears in `companiesProcessed` on the next tick
   *  (`log-purge-sweep.ts`'s own header, "Batching and resumability"). */
  deleted: number;
}

@Injectable()
export class LogPurgeSweepRunner {
  private readonly logger = new Logger(LogPurgeSweepRunner.name);

  /**
   * One sweep pass. Never throws for a single company's own batch failing — a bad row, a transient DB
   * hiccup — the same "one bad candidate must not sink the whole pass" discipline every sweep in this
   * codebase already holds (`conformity-sweep-runner.ts`'s own header); an unhandled failure here would
   * otherwise also cost every OTHER company its own turn in the SAME pass, which is exactly the
   * starvation this sweep's own per-company batching exists to avoid (see `log-purge-sweep.ts`'s own
   * header, "Why per company, never a global sweep").
   */
  async runSweep(now: Date = new Date()): Promise<RunLogPurgeSweepResult> {
    const retentionDays = readLogRetentionDays();
    if (!isLogPurgeEnabled(retentionDays)) {
      this.logger.log(`Log purge sweep disabled (LOG_RETENTION_DAYS=${retentionDays}) — every row is kept.`);
      return { enabled: false, companiesProcessed: 0, deleted: 0 };
    }

    const cutoff = computeLogPurgeCutoff(now, retentionDays);
    const groups: { companyId: string | null }[] = await prisma.log.findMany({
      where: { timestamp: { lt: cutoff } },
      distinct: ['companyId'],
      select: { companyId: true },
    });

    let deleted = 0;
    for (const { companyId } of groups) {
      try {
        deleted += await this.purgeOneBatch(companyId, cutoff);
      } catch (error) {
        this.logger.error(
          `Log purge failed for ${companyId === null ? 'the instance-level bucket' : `company ${companyId}`} — ` +
            `left untouched, retried next tick: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Log purge sweep (retention ${retentionDays}d, cutoff ${cutoff.toISOString()}): ` +
        `${groups.length} compan${groups.length === 1 ? 'y' : 'ies'}/bucket(s) with expired rows, ` +
        `${deleted} row(s) deleted.`,
    );

    return { enabled: true, companiesProcessed: groups.length, deleted };
  }

  /** Select-then-delete-by-id for ONE company (or the `null` instance-level bucket), capped at
   *  `LOG_PURGE_BATCH_SIZE`, oldest rows first — see this file's own header for why both the cap and
   *  the two-step shape are needed. Returns the number ACTUALLY deleted (`deleteMany`'s own `count`,
   *  not `rows.length`): a row deleted by a genuinely concurrent purge (e.g. an operator's own manual
   *  cleanup) between the select and the delete simply does not raise `count`, which is the honest
   *  outcome — no need to reconcile that against `rows.length` here. */
  private async purgeOneBatch(companyId: string | null, cutoff: Date): Promise<number> {
    const rows: { id: string }[] = await prisma.log.findMany({
      where: { companyId, timestamp: { lt: cutoff } },
      select: { id: true },
      orderBy: { timestamp: 'asc' },
      take: LOG_PURGE_BATCH_SIZE,
    });
    if (rows.length === 0) return 0;

    const { count } = await prisma.log.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return count;
  }
}
