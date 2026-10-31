/**
 * Providers-only half of the ownership-transfer queue, split so a `ROLE=worker` process can consume
 * it too; `transfer.module.ts` is the HTTP half. Keeping the processor here is what lets the expiry
 * sweep run on a worker rather than competing with request serving on an API replica.
 * Does NOT provide `TransferExpiryProcessor` or register the repeatable — that is the CONSUMING half's
 * own job (`transfer-queue-worker.module.ts`), exactly mirroring `billing-core.module.ts` versus
 * `billing-queue-worker.module.ts`. `exports: [BullModule]` is what lets that OTHER module's own
 * `@InjectQueue(Q_COMPANY_TRANSFER)`/`@Processor()` resolve a connection registered under
 * `TRANSFER_BULL_CONFIG_KEY` without redefining it — see `queue/transfer-queue.constants.ts`'s own
 * header for why an unnamed `forRoot()` here would be a bug.
 */
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';

import { redisConnection } from '../../documents/queue/redis.config';
import { TransferExpirySweepRunner } from './transfer-expiry-sweep-runner';
import { Q_COMPANY_TRANSFER, TRANSFER_BULL_CONFIG_KEY } from './queue/transfer-queue.constants';

@Module({
  imports: [
    BullModule.forRoot(TRANSFER_BULL_CONFIG_KEY, { connection: redisConnection() }),
    BullModule.registerQueue({ configKey: TRANSFER_BULL_CONFIG_KEY, name: Q_COMPANY_TRANSFER }),
  ],
  providers: [MailService, TransferExpirySweepRunner],
  exports: [BullModule, TransferExpirySweepRunner],
})
export class TransferCoreModule {}
