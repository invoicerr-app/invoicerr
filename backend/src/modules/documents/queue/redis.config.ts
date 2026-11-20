/**
 * Single source of truth for the BullMQ/Redis connection options — carried over from the pre-refonte
 * compliance queue (git tag `avant-refonte-documents`,
 * `compliance/nest/queue/redis.config.ts`) essentially verbatim: the precedence rule and the
 * `docker-compose.scale.yml` env vars it reads are unchanged, only the module it now lives under.
 *
 * Precedence: `REDIS_URL` (e.g. `redis://:pass@redis:6379`) wins when present; otherwise the
 * connection is composed from `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` (defaults: localhost:6379,
 * no password) — this is what lets the CI `cypress-run` job's bare `redis:7` service (port 6379, no
 * REDIS_URL set on the backend) work with no backend env change at all.
 */
import type Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';

import { createLibRedisClient } from '@/lib/redis-connection';

// Both now live next to the client factory, which reads the env through the same function.
export { describeRedisTarget, redisConnection } from '@/lib/redis-connection';

/**
 * A genuine `ioredis` client (as opposed to `redisConnection()`'s own return value above, which is a
 * BullMQ-flavored `ConnectionOptions`: its `{ url }` shape is a `bullmq` extension ioredis's own
 * constructor does not understand), for the document-events pub/sub bridge (T1/R8,
 * `document-events-publisher.ts`/`document-events-bridge.ts`), which talks to Redis directly rather
 * than through BullMQ. Built by the backend's single client factory, `lib/redis-connection.ts`, which
 * applies the same precedence as `redisConnection()`.
 */
export function createIoredisClient(options: RedisOptions = {}): Redis {
  return createLibRedisClient(options);
}
