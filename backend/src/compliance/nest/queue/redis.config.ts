import type { ConnectionOptions } from 'bullmq';

/**
 * Single source of truth for the BullMQ/Redis connection options.
 *
 * Precedence: `REDIS_URL` (e.g. `redis://:pass@redis:6379`) wins when present;
 * otherwise the connection is composed from `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`
 * (defaults: localhost:6379, no password).
 */
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
