/**
 * Consumes the ONE repeatable job `TransferModule#onApplicationBootstrap` registers — see
 * `transfer-queue.constants.ts`'s own header for why this feature owns a dedicated queue.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { RunTransferExpirySweepResult, TransferExpirySweepRunner } from '../transfer-expiry-sweep-runner';
import {
  Q_COMPANY_TRANSFER,
  TRANSFER_BULL_CONFIG_KEY,
  TRANSFER_EXPIRY_SWEEP_JOB_NAME,
} from './transfer-queue.constants';

// `configKey` must match `transfer.module.ts`'s own `BullModule.forRoot()` call — see
// `TRANSFER_BULL_CONFIG_KEY`'s own comment for why an unnamed `forRoot()` here would silently share a
// connection config with whichever OTHER module's own unnamed `forRoot()` the DI container resolves
// last, defeating this module's own self-containment.
@Processor({ name: Q_COMPANY_TRANSFER, configKey: TRANSFER_BULL_CONFIG_KEY })
export class TransferExpiryProcessor extends WorkerHost {
  constructor(private readonly runner: TransferExpirySweepRunner) {
    super();
  }

  async process(job: Job): Promise<RunTransferExpirySweepResult> {
    if (job.name !== TRANSFER_EXPIRY_SWEEP_JOB_NAME) {
      throw new Error(`Unknown job "${job.name}" on the ${Q_COMPANY_TRANSFER} queue`);
    }
    return this.runner.runSweep();
  }
}
