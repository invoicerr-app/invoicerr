import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  PollJobData,
  Q_POLL,
  Q_REPORT,
  Q_SWEEP,
  Q_TIMER,
  Q_TRANSMIT,
  TimerJobData,
  TransmitJobData,
} from './queue.constants';

/**
 * The single point of enqueueing for the compliance async status loop.
 *
 * Every `enqueue*` method uses a deterministic `jobId` (`<kind>-<documentId>`) so that
 * re-enqueueing the same effect is a no-op/idempotent operation — see QUEUE_IMPL_PLAN.md
 * Décision 5 (jobId déterministe + registre DB + sweep).
 *
 * NOTE: the separator is `-`, not `:` — BullMQ's `Job.validateOptions` rejects any custom jobId
 * containing a single `:` (`Custom Id cannot contain :`; reserved for its own internal repeatable-job
 * id format, which requires exactly two colons). This surfaced in Phase 2 (QUEUE_IMPL_PLAN.md §9)
 * the first time this dispatcher was actually exercised end-to-end — Phase 1 never called it for
 * real (see the module docstring history), so the bug was latent until now.
 *
 * PHASE 1 NOTE: this dispatcher is infrastructure only. Nothing in the business logic
 * (compliance-service.ts, apply-signal.ts, invoices.service.ts) calls it yet — that wiring
 * is Phase 2+. It exists now so the queue topology + worker split can be proven end-to-end
 * (see queue-smoke.redis.spec.ts) ahead of the business cut-over.
 */
@Injectable()
export class ComplianceQueueDispatcher {
  private readonly logger = new Logger(ComplianceQueueDispatcher.name);

  constructor(
    @InjectQueue(Q_TRANSMIT) private readonly transmitQueue: Queue<TransmitJobData>,
    @InjectQueue(Q_POLL) private readonly pollQueue: Queue<PollJobData>,
    @InjectQueue(Q_TIMER) private readonly timerQueue: Queue<TimerJobData>,
    @InjectQueue(Q_REPORT) private readonly reportQueue: Queue,
    @InjectQueue(Q_SWEEP) private readonly sweepQueue: Queue,
  ) {}

  async enqueueTransmit(documentId: string, idempotencyKey?: string): Promise<void> {
    const attempts = parseInt(process.env.QUEUE_TRANSMIT_ATTEMPTS ?? '3', 10);
    await this.transmitQueue.add(
      'transmit',
      { documentId, idempotencyKey },
      {
        jobId: `transmit-${documentId}`,
        attempts,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`[TRANSMIT] job enqueued for document ${documentId}`);
  }

  async enqueuePoll(documentId: string, scheduledJobId: string, delayMs: number): Promise<void> {
    await this.pollQueue.add(
      'poll',
      { documentId, scheduledJobId },
      {
        jobId: `poll-${documentId}`,
        delay: Math.max(0, delayMs),
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`[POLL] job enqueued for document ${documentId} (delay=${delayMs}ms)`);
  }

  async enqueueTimer(documentId: string, scheduledJobId: string, delayMs: number): Promise<void> {
    await this.timerQueue.add(
      'timer',
      { documentId, scheduledJobId },
      {
        jobId: `timer-${documentId}`,
        delay: Math.max(0, delayMs),
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`[TIMER] job enqueued for document ${documentId} (delay=${delayMs}ms)`);
  }

  /**
   * Best-effort removal of any in-flight transmit/poll/timer job for a document — used when a
   * document transitions to a state that supersedes those effects (e.g. APPLIED after a signal).
   * Relies on the deterministic jobId; missing jobs are silently ignored.
   */
  async removeForDocument(documentId: string): Promise<void> {
    const targets: Array<[Queue, string]> = [
      [this.transmitQueue, `transmit-${documentId}`],
      [this.pollQueue, `poll-${documentId}`],
      [this.timerQueue, `timer-${documentId}`],
    ];
    for (const [queue, jobId] of targets) {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
        }
      } catch (err) {
        this.logger.warn(`[REMOVE] could not remove job ${jobId}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Registers the repeatable singleton jobs (reporting-close daily, sweep/reconcile on an
   * interval). Idempotent: BullMQ dedups a repeat definition by its repeat key across the whole
   * cluster, so calling this on every boot (API inline or worker) is safe.
   */
  async registerRepeatables(): Promise<void> {
    const reconcileHours = parseInt(process.env.COMPLIANCE_RECONCILE_HOURS ?? '1', 10);

    await this.reportQueue.add(
      'report',
      {},
      {
        jobId: 'report-singleton',
        repeat: { pattern: '0 2 * * *' },
        removeOnComplete: true,
      },
    );

    await this.sweepQueue.add(
      'sweep',
      {},
      {
        jobId: 'sweep-singleton',
        repeat: { every: reconcileHours * 3_600_000 },
        removeOnComplete: true,
      },
    );

    this.logger.log('[REPEATABLES] compliance-report + compliance-sweep registered');
  }
}
