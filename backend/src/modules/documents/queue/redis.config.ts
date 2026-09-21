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
import type { ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';

import { redactUrlCredentials } from '@/utils/redact-url';

export function redisConnection(): ConnectionOptions {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL } as ConnectionOptions;
  }

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  };
}

/**
 * A genuine `ioredis` client (as opposed to `redisConnection()`'s own return value above, which is a
 * BullMQ-flavored `ConnectionOptions` — its `{ url }` shape is a `bullmq` extension ioredis's own
 * constructor does not understand) — for the document-events pub/sub bridge (T1/R8,
 * `document-events-publisher.ts`/`document-events-bridge.ts`), which talks to Redis directly rather
 * than through BullMQ. Same precedence as `redisConnection()`, deliberately kept in sync: two Redis
 * connection helpers agreeing on different rules would be its own bug waiting to happen.
 */
export function createIoredisClient(): Redis {
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL);
  }
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  });
}

/**
 * Human-facing description of where this process is trying to reach Redis — used by
 * `redis-required.guard.ts` for its boot-time SUCCESS log line and its "Redis unreachable" failure
 * message, so a crash NAMES a target instead of leaving whoever reads the log to go re-derive it
 * from env vars themselves.
 *
 * NEVER the raw `REDIS_URL`. That variable's documented shape carries the password inline
 * (`redis://:pass@redis:6379`, this file's own header), so returning it verbatim printed the
 * credential of every authenticated Redis — which is the normal case on any managed instance — to
 * stdout on every single boot, and again inside an exception message whenever Redis was slow to come
 * up. Everything that touches a container's stdout then holds it: the log aggregator, `docker logs`,
 * an incident capture, a support archive. `redactUrlCredentials` keeps scheme, user, host, port and
 * database index (all of which is what makes this line worth logging) and replaces only the secret.
 *
 * The `REDIS_HOST`/`REDIS_PORT` branch never had the problem: `REDIS_PASSWORD` is a separate variable
 * and was never part of this string.
 */
export function describeRedisTarget(): string {
  if (process.env.REDIS_URL) return redactUrlCredentials(process.env.REDIS_URL);
  return `${process.env.REDIS_HOST ?? 'localhost'}:${process.env.REDIS_PORT ?? '6379'}`;
}
