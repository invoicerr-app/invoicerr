/**
 * The one ioredis client factory of the backend. Every direct Redis client is built here: the
 * Redis-backed rate-limit storage (`app.module.ts`'s `ThrottlerModule.forRoot` and
 * `lib/auth-rate-limit.ts`), the per-company SSO registry's cross-replica sync, the legal-release
 * notification lock, the session cache, the pending-signup store (`lib/pending-signup-store.ts`), the
 * health probe (`modules/health/health.service.ts`) and, through
 * `modules/documents/queue/redis.config.ts#createIoredisClient`, the document-events pub/sub bridge.
 *
 * It lives in `lib/` so that none of those callers has to import a documents-module internal. The
 * same logic used to be copied three times (here, in `pending-signup-store.ts` and in
 * `redis.config.ts`), and two copies had already drifted on where caller options were spread.
 *
 * Precedence: `REDIS_URL` wins when set; otherwise `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
 * (defaults localhost:6379, no password). `redis.config.ts#redisConnection` applies the same rule to
 * BullMQ's own connection options; the two must keep agreeing, since a client resolving to a different
 * Redis than the queues would be a much worse bug than any duplication.
 */
import Redis, { RedisOptions } from 'ioredis';

export function createLibRedisClient(options: RedisOptions = {}): Redis {
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, options);
  }
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    ...options,
  });
}
