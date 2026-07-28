import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PingJobData, Q_PING } from '../queue.constants';

/**
 * PHASE 1 DEMO PROCESSOR ONLY.
 *
 * Proves the API/worker split (enqueue from one process, consume from another — or
 * inline, when WORKER_INLINE=true) on a disposable, non-business queue. No compliance
 * domain logic is wired to this queue; it exists purely so queue-smoke.redis.spec.ts can
 * exercise a real enqueue -> consume round-trip against Redis. Safe to delete once a real
 * processor (transmit/poll/timer) lands in a later phase and exercises the same split.
 */
@Processor(Q_PING)
export class PingProcessor extends WorkerHost {
  private readonly logger = new Logger(PingProcessor.name);

  async process(job: Job<PingJobData, { pong: true; sentAt: string }, string>) {
    this.logger.log(`Processing ping job ${job.id} (sentAt=${job.data.sentAt})`);
    return { pong: true as const, sentAt: job.data.sentAt };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Ping job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`Ping job ${job?.id} failed: ${error.message}`);
  }
}
