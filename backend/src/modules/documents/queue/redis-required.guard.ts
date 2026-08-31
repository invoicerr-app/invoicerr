/**
 * Redis is REQUIRED to boot this app — never a silently-degraded synchronous fallback (TODO.md item
 * 22's own wording). BullMQ's own `Queue`/`Worker` classes do not enforce that themselves: ioredis
 * retries a broken connection forever by default, so a Nest app wired only with `BullModule.forRoot`
 * would boot "successfully" and simply never process a single job, with nothing but a stream of retry
 * warnings in the log to notice by. This provider is what turns that into a LOUD, NAMED failure.
 *
 * A throw from `onModuleInit` propagates straight out of `NestFactory.create()`/
 * `createApplicationContext()` (main.ts / worker.ts both `.catch()` their own bootstrap and
 * `process.exit(1)`), so an unreachable Redis is a crash on startup, not a silently-half-working
 * process.
 *
 * Deliberately a SEPARATE, throwaway ioredis client rather than reusing the BullMQ connection
 * `DocumentQueueModule` registers: BullMQ's `Worker` requires `maxRetriesPerRequest: null` on ITS
 * OWN connection (it throws at construction otherwise — it needs to block indefinitely on certain
 * commands) — exactly the opposite of what a bounded, fail-fast health check needs. Keeping this
 * client separate means neither one has to compromise: the health check gets a short, bounded
 * timeout and gives up after one attempt; the real queue connection keeps BullMQ's own required
 * defaults untouched.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

import { describeRedisTarget, redisConnection } from './redis.config';

@Injectable()
export class DocumentQueueRedisRequiredGuard implements OnModuleInit {
  private readonly logger = new Logger(DocumentQueueRedisRequiredGuard.name);

  async onModuleInit(): Promise<void> {
    const target = describeRedisTarget();
    const connection = redisConnection() as { url?: string } & Record<string, unknown>;
    const client = connection.url
      ? new Redis(connection.url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
          connectTimeout: 3000,
        })
      : new Redis({
          ...connection,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
          connectTimeout: 3000,
        });

    // ioredis logs its own "error" event to the console by default even when the caller handles the
    // rejection — silence it here, the thrown Error below is this guard's only reporting channel.
    client.on('error', () => undefined);

    try {
      await client.connect();
      await client.ping();
      this.logger.log(`Redis reachable at ${target} — document action queue can boot.`);
    } catch (error) {
      throw new Error(
        `Redis is required to boot (document action queue, TODO.md item 22) but is unreachable at ` +
          `${target}: ${error instanceof Error ? error.message : String(error)}. Set REDIS_URL (or ` +
          'REDIS_HOST/REDIS_PORT/REDIS_PASSWORD) to a reachable Redis instance — there is no degraded ' +
          'synchronous fallback.',
      );
    } finally {
      client.disconnect();
    }
  }
}
