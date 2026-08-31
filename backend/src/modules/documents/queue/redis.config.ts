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

/** Human-facing description of where this process is trying to reach Redis — used only by
 *  `redis-required.guard.ts`'s boot-time failure message, so a "Redis unreachable" crash NAMES a
 *  target instead of leaving whoever reads the log to go re-derive it from env vars themselves. */
export function describeRedisTarget(): string {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  return `${process.env.REDIS_HOST ?? 'localhost'}:${process.env.REDIS_PORT ?? '6379'}`;
}
