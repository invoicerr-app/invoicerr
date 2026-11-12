import { InjectQueue } from '@nestjs/bullmq';
import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

import { ConfiguredRepeatable, retireSupersededRepeatables } from '@/lib/queue-repeatables';

import { BillingCoreModule } from './billing-core.module';
import { BillingLifecycleProcessor } from './queue/billing-lifecycle.processor';
import {
  BILLING_LIFECYCLE_SWEEP_JOB_ID,
  BILLING_LIFECYCLE_SWEEP_JOB_NAME,
  Q_BILLING_LIFECYCLE,
  readBillingLifecycleSweepIntervalMs,
} from './queue/billing-queue.constants';

/**
 * Consuming half of the billing-lifecycle queue. Nest only instantiates `@Processor()` classes
 * reachable from an imported module, so gating this import gates consumption entirely.
 *
 * Registering the repeatable on every process is safe: BullMQ dedups it by key. `attempts: 1`
 * because the next tick is already the retry. A repeatable's key includes its interval, so changing
 * the interval adds a definition instead of replacing it; hence the retire step.
 */
@Module({
  imports: [BillingCoreModule],
  providers: [BillingLifecycleProcessor],
})
export class BillingQueueWorkerModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(Q_BILLING_LIFECYCLE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    const configured: ConfiguredRepeatable = {
      name: BILLING_LIFECYCLE_SWEEP_JOB_NAME,
      repeat: { every: readBillingLifecycleSweepIntervalMs() },
    };
    await this.queue.add(
      configured.name,
      {},
      {
        jobId: BILLING_LIFECYCLE_SWEEP_JOB_ID,
        repeat: configured.repeat,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await retireSupersededRepeatables(this.queue, [configured]);
  }
}
