import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  BillingLifecycleSweepRunner,
  RunBillingLifecycleSweepResult,
} from '../billing-lifecycle-sweep-runner';
import { SubscriptionInvoiceIssuer } from '../subscription-invoice-issuer';
import {
  BILLING_BULL_CONFIG_KEY,
  BILLING_LIFECYCLE_SWEEP_JOB_NAME,
  Q_BILLING_LIFECYCLE,
} from './billing-queue.constants';

// `configKey` must match billing's own `BullModule.forRoot()`; without it this worker silently falls
// back to the shared "default" connection, which only works by coincidence.
@Processor({ name: Q_BILLING_LIFECYCLE, configKey: BILLING_BULL_CONFIG_KEY })
export class BillingLifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingLifecycleProcessor.name);

  constructor(
    private readonly runner: BillingLifecycleSweepRunner,
    private readonly invoiceIssuer: SubscriptionInvoiceIssuer,
  ) {
    super();
  }

  async process(job: Job): Promise<RunBillingLifecycleSweepResult> {
    if (job.name !== BILLING_LIFECYCLE_SWEEP_JOB_NAME) {
      throw new Error(`Unknown job "${job.name}" on the ${Q_BILLING_LIFECYCLE} queue`);
    }
    const result = await this.runner.runSweep();
    // Same tick, separate failure domain: a broken invoice step never fails the lifecycle sweep.
    try {
      await this.invoiceIssuer.issuePending();
    } catch (error) {
      this.logger.error(
        `Subscription invoice issuing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return result;
  }
}
