/**
 * Providers-only half of the ownership-transfer queue — split out of `transfer.module.ts` so a
 * dedicated `ROLE=worker` process can consume `Q_COMPANY_TRANSFER` too
 * (`transfer-queue-worker.module.ts`, the CONSUMING half), the same Core/HTTP/Worker split
 * `documents-core.module.ts` / `documents.module.ts` / `queue/document-queue-worker.module.ts` and
 * `billing-core.module.ts` / `billing.module.ts` / `billing-queue-worker.module.ts` already hold.
 *
 * BEFORE this split, `TransferModule` (unchanged in shape otherwise, see that file's own header) was
 * imported ONLY by `AppModule` — `worker.module.ts` never touched it — so `TransferExpirySweepRunner`'s
 * own repeatable always ran on an API replica, competing with request serving, while the target
 * topology's dedicated workers sat idle for it.
 *
 * `MailService` is provided directly here — a leaf, empty-constructor provider (see
 * `documents-core.module.ts`/`billing-core.module.ts`'s own headers for the "every module that needs
 * it just lists it in its own providers" convention this follows).
 *
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
