import { InjectQueue } from '@nestjs/bullmq';
import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

import { TransferCoreModule } from './transfer-core.module';
import { TransferExpiryProcessor } from './queue/transfer-expiry.processor';
import {
  Q_COMPANY_TRANSFER,
  readTransferExpirySweepIntervalMs,
  TRANSFER_EXPIRY_SWEEP_JOB_ID,
  TRANSFER_EXPIRY_SWEEP_JOB_NAME,
} from './queue/transfer-queue.constants';

/**
 * The CONSUMING half of the ownership-transfer queue — the gate target for `WORKER_INLINE`
 * (default `true`), the exact same split `app.module.ts`'s own comment documents for the documents
 * queue and `billing-queue-worker.module.ts` now mirrors for billing: `WorkerModule` (`ROLE=worker`)
 * ALWAYS imports this (transfer has no enable/disable flag — it works in self-hosted mode too, see
 * `transfer.module.ts`'s own header — so unlike billing's own worker import, this one is never
 * further gated); `AppModule` imports it only when `WORKER_INLINE !== 'false'`.
 *
 * Imports `TransferCoreModule` (never `TransferModule`, which also carries the HTTP controllers this
 * worker process has no use for) so `TransferExpiryProcessor` gets the SAME DI-wired
 * `TransferExpirySweepRunner` the API process would have used inline.
 *
 * `onApplicationBootstrap` registers the ONE repeatable sweep job here (moved from
 * `transfer.module.ts` — see that file's own header) — idempotent (BullMQ dedups a repeatable
 * definition by its own key across the whole cluster), same `attempts: 1` reasoning every sibling
 * sweep in this codebase documents.
 */
@Module({
  imports: [TransferCoreModule],
  providers: [TransferExpiryProcessor],
})
export class TransferQueueWorkerModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(Q_COMPANY_TRANSFER) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      TRANSFER_EXPIRY_SWEEP_JOB_NAME,
      {},
      {
        jobId: TRANSFER_EXPIRY_SWEEP_JOB_ID,
        repeat: { every: readTransferExpirySweepIntervalMs() },
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
