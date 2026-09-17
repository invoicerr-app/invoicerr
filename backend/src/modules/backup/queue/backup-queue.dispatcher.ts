import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { readBackupScheduleCron } from '../backup.constants';
import { BACKUP_SWEEP_JOB_ID, BACKUP_SWEEP_JOB_NAME, Q_BACKUP } from './backup-queue.constants';

/**
 * Registers the ONE backup-sweep repeatable — the same idempotent-registration guarantee every other
 * repeatable in this codebase already relies on: BullMQ dedups a repeatable definition by its own
 * key across the WHOLE cluster, so calling this on every process that boots the backup module (API
 * inline, or a scaled worker replica) is safe, never a double registration — see
 * `documents/queue/document-queue.dispatcher.ts`'s own sweep-registration methods for the identical
 * pattern this one is modeled on.
 *
 * `attempts: 1`, same reasoning those sweeps document: a run that could not even START (source
 * enumeration itself throwing — `backup-runner.ts`'s own header) is a real bug worth surfacing loudly
 * now, not silently retried moments later — the NEXT scheduled tick is already the natural retry for
 * "the sweep didn't run this time". A single FILE failing inside a run never reaches this level at
 * all — see `backup-runner.ts`'s own header on why that is `COMPLETED`, not a job-level failure.
 *
 * `pattern`, not `every`: `BACKUP_S3_SCHEDULE` is a cron expression (default daily at 03:00 UTC),
 * unlike every OTHER sweep in this codebase (interval-based `every`, in ms) — a backup's natural
 * cadence is "once a day, at a quiet hour", which a cron pattern expresses directly; an interval would
 * only approximate it, drifting further from any specific hour on every process restart.
 */
@Injectable()
export class BackupQueueDispatcher {
  private readonly logger = new Logger(BackupQueueDispatcher.name);

  constructor(@InjectQueue(Q_BACKUP) private readonly queue: Queue) {}

  async registerBackupSweepRepeatable(): Promise<void> {
    const pattern = readBackupScheduleCron();
    await this.queue.add(
      BACKUP_SWEEP_JOB_NAME,
      {},
      {
        jobId: BACKUP_SWEEP_JOB_ID,
        repeat: { pattern, tz: 'UTC' },
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(`Registered the instance-backup sweep repeatable (cron "${pattern}", UTC).`);
  }
}
