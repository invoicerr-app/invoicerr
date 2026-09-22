import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { redisConnection } from '@/modules/documents/queue/redis.config';

import { Q_BACKUP } from './backup-queue.constants';

/**
 * BullMQ wiring for the instance-backup sweep's own queue. `redisConnection()` is reused as-is from
 * `documents/queue/redis.config.ts` — a generic, document-agnostic BullMQ/ioredis connection helper
 * (env-var precedence only, no documents-module concept in it) — rather than duplicated here, so the
 * two queues can never silently disagree about which Redis to use.
 *
 * Passes `connection` directly to `registerQueue` rather than a separate `BullModule.forRoot()` call:
 * `documents/queue/document-queue.module.ts` already calls `forRoot` and is `@Global()`, so a second
 * `forRoot` here would be redundant at best; passing the connection inline instead makes this module
 * fully self-contained — it does not depend on `DocumentQueueModule` having been imported first.
 *
 * NOT `@Global()`, unlike `DocumentQueueModule`: nothing outside `backup/` ever needs to enqueue onto
 * this queue — only this module's own dispatcher (registering the one repeatable) and its own
 * processor (consuming it) do, and both live inside modules that import this one directly
 * (`backup-core.module.ts`).
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_BACKUP, connection: redisConnection() })],
  exports: [BullModule],
})
export class BackupQueueModule {}
