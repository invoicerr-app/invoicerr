import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { readBackupScheduleCron } from './backup.constants';
import { BackupRunSummary, getLatestBackupRun } from './backup-runs.persistence';
import { BACKUP_SWEEP_JOB_NAME, Q_BACKUP } from './queue/backup-queue.constants';

/**
 * What `GET /api/backup/status` actually puts on the wire for the last run — `BackupRunSummary` minus
 * `errors`. This route is `@Roles(OWNER)` with no `@ActiveCompany()` scoping (`backup.controller.ts`'s
 * own header: there is no narrower "instance operator" role in this app), so ANY company's OWNER can
 * read it — but a run's `errors` carry per-file object KEYS, and every key in this module embeds
 * another tenant's identifier (`inbound/<companyId>/<sha256>.<ext>`, `archive/<documentId>/…`), plus
 * raw fs/S3 error text that can itself contain filesystem paths. None of that may cross the tenant
 * boundary this route sits on. `filesFailed` already says HOW MANY files failed; that is the entire
 * signal this route needs to carry — the keyed detail stays in `BackupRun` in the database for an
 * operator who has shell/DB access, never for a company OWNER over the API.
 */
export type PublicBackupRunSummary = Omit<BackupRunSummary, 'errors'>;

function toPublicBackupRunSummary(run: BackupRunSummary): PublicBackupRunSummary {
  const { errors: _errors, ...rest } = run;
  return rest;
}

export interface BackupStatusView {
  /** The configured cron pattern (`BACKUP_S3_SCHEDULE`, default daily 03:00 UTC) — echoed back so the
   *  caller does not have to separately know what this instance was configured with. */
  schedule: string;
  lastRun: PublicBackupRunSummary | null;
  /** ISO-8601, or `null` if the repeatable has not been registered yet (should only ever happen in
   *  the brief window between this module entering the graph and its own `onApplicationBootstrap`
   *  running — see `backup-queue-worker.module.ts`). */
  nextRunAt: string | null;
}

/**
 * Read side for `GET /api/backup/status` — `nextRunAt` comes straight from BullMQ's own scheduler
 * bookkeeping (`Queue.getJobSchedulers()`), never a hand-rolled cron-expression parser: BullMQ already
 * parses `BACKUP_S3_SCHEDULE` once, at registration time (`queue/backup-queue.dispatcher.ts`), and
 * keeps its own `next` timestamp current on every tick — duplicating that logic here (a second cron
 * parser, liable to disagree with BullMQ's own) is exactly the "custom … machinery" this codebase's
 * own CLAUDE.md warns against; a library already does this correctly.
 *
 * Filtered by job NAME (`BACKUP_SWEEP_JOB_NAME`), not by the `jobId` this module registers the
 * repeatable under: BullMQ v5 derives a job scheduler's own internal id from a hash of its repeat
 * options, not from the caller's `jobId` verbatim — the job NAME is the one stable, human-chosen key
 * both sides agree on, and this queue only ever registers exactly one repeatable under it.
 */
@Injectable()
export class BackupStatusService {
  constructor(@InjectQueue(Q_BACKUP) private readonly queue: Queue) {}

  async getStatus(): Promise<BackupStatusView> {
    const [lastRun, schedulers] = await Promise.all([getLatestBackupRun(), this.queue.getJobSchedulers()]);
    const scheduler = schedulers.find((entry) => entry.name === BACKUP_SWEEP_JOB_NAME);
    return {
      schedule: readBackupScheduleCron(),
      lastRun: lastRun ? toPublicBackupRunSummary(lastRun) : null,
      nextRunAt: scheduler?.next ? new Date(scheduler.next).toISOString() : null,
    };
  }
}
