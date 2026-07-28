import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaReportingStore } from '../../../reporting/prisma-reporting-store';
import { Q_REPORT } from '../queue.constants';

/**
 * QUEUE_IMPL_PLAN.md §4.5/§9 Phase 3 — the reporting period-close loop, migrated from
 * `ComplianceCron.tickReportingClose()` (removed in this phase — see §5.8) onto a BullMQ
 * repeatable job (registered daily, `'0 2 * * *'`, by `ComplianceQueueDispatcher.registerRepeatables()`).
 *
 * No `CronLockService` needed: BullMQ dedups a repeatable job's key across the whole cluster, so
 * only one worker instance ever executes a given scheduled run.
 *
 * Idempotent: `PrismaReportingStore.findPendingForClosedPeriods()` only returns records still
 * PENDING — once `markSubmitted()` flips a record to SUBMITTED, a second run (or a duplicate
 * delivery) finds nothing to do for it.
 */
@Processor(Q_REPORT)
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(private readonly reportingStore: PrismaReportingStore) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    const pending = await this.reportingStore.findPendingForClosedPeriods(now);
    if (pending.length === 0) {
      this.logger.debug('[REPORT] no PENDING records for closed periods');
      return;
    }
    this.logger.log(`[REPORT] submitting ${pending.length} PENDING record(s) for closed periods`);

    let submitted = 0;
    let failed = 0;
    for (const record of pending) {
      try {
        // Mocked submission seam — same as the legacy cron: real authority I/O is a per-kind TODO
        // (see handlers.ts). The record transitions to SUBMITTED so a duplicate/second run is a
        // no-op (idempotence via the PENDING-only filter in findPendingForClosedPeriods).
        const mockRef = `mock-period-close:${record.kind}:${record.periodKey}:${record.id}`;
        await this.reportingStore.markSubmitted(record.id, mockRef, now);
        this.logger.debug(
          `[REPORT] [MOCK] submitted ${record.kind} period=${record.periodKey} company=${record.companyId ?? 'n/a'} ref=${mockRef}`,
        );
        submitted++;
      } catch (err) {
        failed++;
        this.logger.error(
          `[REPORT] failed to submit record ${record.id} (${record.kind}/${record.periodKey}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(`[REPORT] done — ${submitted} submitted, ${failed} failed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`[REPORT] job ${job?.id} failed: ${error.message}`);
  }
}
