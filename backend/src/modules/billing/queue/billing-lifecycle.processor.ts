/**
 * Consumes the ONE repeatable job `BillingModule#onApplicationBootstrap` registers — see
 * `billing-queue.constants.ts`'s own header for why billing owns a dedicated queue rather than
 * joining the documents module's `Q_DOCUMENT_ACTION`.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  BillingLifecycleSweepRunner,
  RunBillingLifecycleSweepResult,
} from '../billing-lifecycle-sweep-runner';
import {
  BILLING_BULL_CONFIG_KEY,
  BILLING_LIFECYCLE_SWEEP_JOB_NAME,
  Q_BILLING_LIFECYCLE,
} from './billing-queue.constants';

// `configKey` must match `billing.module.ts`'s own `BullModule.forRoot()` call — see
// `BILLING_BULL_CONFIG_KEY`'s own comment. Without it this worker would resolve its connection from
// the "default" shared config instead (silently working today only because `DocumentQueueModule`'s
// own default config happens to compute the identical `redisConnection()`), defeating the very
// self-containment that named config key exists to guarantee.
@Processor({ name: Q_BILLING_LIFECYCLE, configKey: BILLING_BULL_CONFIG_KEY })
export class BillingLifecycleProcessor extends WorkerHost {
  constructor(private readonly runner: BillingLifecycleSweepRunner) {
    super();
  }

  async process(job: Job): Promise<RunBillingLifecycleSweepResult> {
    if (job.name !== BILLING_LIFECYCLE_SWEEP_JOB_NAME) {
      throw new Error(`Unknown job "${job.name}" on the ${Q_BILLING_LIFECYCLE} queue`);
    }
    return this.runner.runSweep();
  }
}
