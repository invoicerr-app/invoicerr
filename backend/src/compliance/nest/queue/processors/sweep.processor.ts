import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InboundRouter } from '../../../lifecycle/drivers/inbound-router';
import { InboxPoller } from '../../../lifecycle/drivers/inbox-poller';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../../../persistence/prisma-scheduled-job-store';
import { ComplianceQueueDispatcher } from '../compliance-queue.dispatcher';
import { Q_SWEEP } from '../queue.constants';

/**
 * QUEUE_IMPL_PLAN.md §4.5/§9 Phase 3 — the reconcile/sweep safety net, migrated off
 * `ComplianceCron`'s `reconcile('boot'|'periodic')` + `replayInbound()` + `tickInbox()` (all removed
 * in this phase — see §5.8) onto a single BullMQ repeatable job (registered every
 * `COMPLIANCE_RECONCILE_HOURS`, default reused from the legacy cron's interval, by
 * `ComplianceQueueDispatcher.registerRepeatables()`).
 *
 * BullMQ delayed jobs are only a projection of the durable `ScheduledJob` registry (Décision 5 —
 * outbox-lite): a Redis flush, a crashed worker, or a job that silently never got enqueued all leave
 * the ScheduledJob row as the source of truth. This sweep re-projects that truth onto BullMQ so the
 * system self-heals without needing a distributed lock — every re-projection uses the deterministic
 * `jobId` (`poll-<docId>` / `timer-<docId>`), so re-enqueueing an already-in-flight job is a no-op.
 *
 * Three responsibilities per pass:
 *   1. Overdue timers (`timerStore.due(now)`) — ARMED timers whose deadline has already elapsed but
 *      have no live BullMQ job (e.g. survived a Redis flush) → re-enqueue with delay 0.
 *   2. Orphaned polls (`pollStore.pending()`) — every still-PENDING/ARMED poll job, regardless of
 *      whether a `compliance-poll` job is currently in flight for it → re-enqueue with delay 0
 *      (idempotent: BullMQ dedups by the deterministic jobId, so this is a no-op if one is already
 *      running).
 *   3. Replay unapplied inbound (`InboundRouter.replayUnapplied()`) — re-applies any stored inbound
 *      message whose `applySignal()` call never completed (crash window), plus one `InboxPoller.tick()`
 *      pass (SFTP/IMAP inbox ports; a no-op when none are configured — see NullInboxPort).
 */
@Processor(Q_SWEEP)
export class SweepProcessor extends WorkerHost {
  private readonly logger = new Logger(SweepProcessor.name);

  constructor(
    private readonly pollStore: PrismaPollJobStore,
    private readonly timerStore: PrismaTimerJobStore,
    private readonly dispatcher: ComplianceQueueDispatcher,
    private readonly inboundRouter: InboundRouter,
    private readonly inboxPoller: InboxPoller,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();

    // (1) Overdue timers — fire ARMED timers whose deadline already elapsed but have no live job.
    const dueTimers = await this.timerStore.due(now);
    for (const timer of dueTimers) {
      await this.dispatcher.enqueueTimer(timer.documentId, timer.id, 0);
    }
    if (dueTimers.length > 0) {
      this.logger.log(`[SWEEP] re-projected ${dueTimers.length} overdue timer(s)`);
    }

    // (2) Orphaned polls — re-project every still-pending poll job (no-op if already in flight).
    const pendingPolls = await this.pollStore.pending();
    for (const poll of pendingPolls) {
      await this.dispatcher.enqueuePoll(poll.documentId, poll.id, 0);
    }
    if (pendingPolls.length > 0) {
      this.logger.log(`[SWEEP] re-projected ${pendingPolls.length} pending poll(s)`);
    }

    // (3) Replay unapplied inbound messages (crash window between recordMessage() and applySignal()).
    try {
      const { replayed, skipped } = await this.inboundRouter.replayUnapplied();
      if (replayed > 0 || skipped > 0) {
        this.logger.log(`[SWEEP] inbound replay: ${replayed} replayed, ${skipped} skipped`);
      }
    } catch (err) {
      this.logger.error(
        `[SWEEP] inbound replay failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // (3b) Inbox tick — poll configured InboxPort(s) (SFTP/IMAP) for new inbound documents. A no-op
    // when only NullInboxPort is configured (default, offline-safe).
    try {
      const report = await this.inboxPoller.tick();
      if (report.fetched > 0 || report.errors > 0) {
        this.logger.log(
          `[SWEEP] inbox tick: fetched=${report.fetched} routed=${report.routed} duplicates=${report.duplicates} unmatched=${report.unmatched} errors=${report.errors}`,
        );
      }
    } catch (err) {
      this.logger.error(`[SWEEP] inbox tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`[SWEEP] job ${job?.id} failed: ${error.message}`);
  }
}
