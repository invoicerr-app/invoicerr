import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ApplySignalService } from '../../apply-signal';
import { PrismaTimerJobStore } from '../../../persistence/prisma-scheduled-job-store';
import { TimerJobData, Q_TIMER } from '../queue.constants';

/**
 * QUEUE_IMPL_PLAN.md §4.5/§9 Phase 3 — the real TIMER path (ARM_TIMER effects).
 *
 * One job = one `ScheduledJob` (TIMER) row, unlike the legacy `TimerScheduler.tick()` which scans
 * every `due()` job in one pass. This is `TimerScheduler.tick()` re-hosted on a BullMQ delayed job:
 * `store.get(scheduledJobId)` → if the job is still ARMED and its deadline has actually elapsed →
 * `store.save({...job, status:'FIRED'})` → `ApplySignalService.apply(documentId, {type:'TIMER_ELAPSED'})`.
 * The runtime re-resolves TIMER_ELAPSED into the legal event from the graph (e.g. ACCEPT) itself, or
 * NOOPs if the document already left the guarded state — so a stale/duplicate fire (e.g. from the
 * sweep re-projecting an already-fired job) is always a safe no-op, exactly like the legacy scheduler.
 *
 * Does NOT reimplement the timer/deadline math: `createTimerJob`/`TimerJob` (timer-job.ts, the pure
 * core) are reused as-is; only the "which job to check + how it's triggered" changes.
 */
@Processor(Q_TIMER)
export class TimerProcessor extends WorkerHost {
  private readonly logger = new Logger(TimerProcessor.name);

  constructor(
    private readonly timerStore: PrismaTimerJobStore,
    private readonly applySignal: ApplySignalService,
  ) {
    super();
  }

  async process(job: Job<TimerJobData>): Promise<void> {
    const { documentId, scheduledJobId } = job.data;
    const timerJob = await this.timerStore.get(scheduledJobId);
    if (!timerJob) {
      this.logger.log(`[TIMER] scheduled job ${scheduledJobId} for ${documentId} no longer exists — skip`);
      return;
    }
    if (timerJob.status !== 'ARMED') {
      this.logger.log(
        `[TIMER] scheduled job ${scheduledJobId} for ${documentId} is ${timerJob.status} (not ARMED) — skip`,
      );
      return;
    }

    const now = new Date();
    if (new Date(timerJob.fireAt).getTime() > now.getTime()) {
      // Not actually due yet (e.g. a sweep re-projection fired this early) — leave it ARMED, the
      // real delayed job (or a later sweep pass) will fire it once its deadline elapses.
      this.logger.log(
        `[TIMER] job ${scheduledJobId} for ${documentId} not yet due (fireAt=${timerJob.fireAt}) — skip`,
      );
      return;
    }

    await this.timerStore.save({ ...timerJob, status: 'FIRED' });
    await this.applySignal.apply(documentId, { type: 'TIMER_ELAPSED' });
    this.logger.log(`[TIMER] ${documentId} elapsed (job ${scheduledJobId}) -> TIMER_ELAPSED`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`[TIMER] job ${job?.id} (doc=${job?.data?.documentId}) failed: ${error.message}`);
  }
}
