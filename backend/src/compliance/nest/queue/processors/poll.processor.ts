import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { ApplySignalService } from '../../apply-signal';
import { defaultLogger } from '../../../execution/logger';
import { decidePoll, outcomeFromTransmission } from '../../../lifecycle/drivers/poll-job';
import { PrismaPollJobStore } from '../../../persistence/prisma-scheduled-job-store';
import { TransmissionProviderRegistry } from '../../../providers/transmission/registry';
import { PollJobData, Q_POLL } from '../queue.constants';

/**
 * QUEUE_IMPL_PLAN.md §4.5/§9 Phase 2 — the real POLL path, fixing F-3.
 *
 * One job = one `ScheduledJob` (POLL) row, unlike the legacy `PollScheduler.tick()`/`.reconcile()`
 * which scans every due/pending job. This is `PollScheduler.pollJobOnce` re-hosted on a BullMQ
 * delayed job: `store.get(scheduledJobId)` → `registry.getById(job.providerId)` (the DI-wired,
 * CREDENTIALED registry — never `defaultTransmissionRegistry`) → `provider.poll(job.ref ?? documentId, …)`
 * (the EXTERNAL ref returned by transmit(), not the internal documentId) → the pure `decidePoll` core
 * → RESOLVE feeds `POLL_RESULT` back through `ApplySignalService.apply()`; EXPIRED just logs
 * (contingency/alert is a TODO, same as the legacy scheduler's default `onExpire`).
 *
 * RESCHEDULE — discovered while writing the Phase 2 integration test (phase2-transmit-poll.spec.ts):
 * re-`dispatcher.enqueuePoll()`-ing under the SAME deterministic jobId (`poll-<documentId>`, Décision
 * 5) while THIS execution is still the active job under that exact jobId is a silent no-op — BullMQ
 * dedupes `add()` by jobId, so it just returns the still-active job instead of creating a new delayed
 * one; the "reschedule" then evaporates the instant this `process()` call returns and BullMQ marks
 * the (only) job complete (`removeOnComplete: true`). The bullmq-idiomatic fix for "re-run this exact
 * job later" is `job.moveToDelayed(until, token)` + `throw new DelayedError()` (bullmq special-cases
 * this error to skip both `attemptsMade` and the `failed` event — see `Worker.handleFailed`) — it
 * delays the SAME job record in place, so there is no second `add()` and no jobId collision.
 */
@Processor(Q_POLL)
export class PollProcessor extends WorkerHost {
  private readonly logger = new Logger(PollProcessor.name);

  constructor(
    private readonly pollStore: PrismaPollJobStore,
    private readonly txRegistry: TransmissionProviderRegistry,
    private readonly applySignal: ApplySignalService,
  ) {
    super();
  }

  async process(job: Job<PollJobData>, token?: string): Promise<void> {
    const { documentId, scheduledJobId } = job.data;
    const pollJob = await this.pollStore.get(scheduledJobId);
    if (!pollJob) {
      this.logger.log(`[POLL] scheduled job ${scheduledJobId} for ${documentId} no longer exists — skip`);
      return;
    }
    if (pollJob.status !== 'PENDING') {
      this.logger.log(
        `[POLL] scheduled job ${scheduledJobId} for ${documentId} is ${pollJob.status} (not PENDING) — skip`,
      );
      return;
    }

    const provider = this.txRegistry.getById(pollJob.providerId);
    if (!provider?.poll) {
      this.logger.warn(
        `[POLL] provider "${pollJob.providerId}" cannot poll; cancelling job ${scheduledJobId}`,
      );
      await this.pollStore.save({ ...pollJob, status: 'CANCELLED' });
      return;
    }

    const result = await provider.poll(pollJob.ref ?? documentId, defaultLogger);
    const now = new Date();
    const decision = decidePoll(pollJob, outcomeFromTransmission(result.status), now);
    await this.pollStore.save(decision.job);

    switch (decision.kind) {
      case 'RESOLVE':
        await this.applySignal.apply(documentId, {
          type: 'POLL_RESULT',
          status: decision.outcome,
          authorityIds: result.authorityIds,
        });
        this.logger.log(`[POLL] ${documentId} resolved: ${decision.outcome} (job ${scheduledJobId})`);
        return;
      case 'RESCHEDULE': {
        const until = new Date(decision.job.nextRunAt).getTime();
        this.logger.log(
          `[POLL] ${documentId} still pending (attempt ${decision.job.attempts}) — delaying until ${decision.job.nextRunAt}`,
        );
        // Re-delay the SAME job/jobId in place (see class docstring) — do not re-enqueue.
        await job.moveToDelayed(until, token);
        throw new DelayedError();
      }
      case 'EXPIRED':
        this.logger.warn(
          `[POLL] job ${scheduledJobId} for ${documentId} expired without resolution — enter contingency / alert (TODO)`,
        );
        return;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    if (error instanceof DelayedError) return; // expected control-flow signal, not a real failure
    this.logger.error(`[POLL] job ${job?.id} (doc=${job?.data?.documentId}) failed: ${error.message}`);
  }
}
