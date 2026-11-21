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
 * (defaults localhost:6379, no password). That rule is read once, by `readRedisEnv()`, and shared by
 * this client factory, BullMQ's own connection options (`redisConnection()`) and the boot log line
 * (`describeRedisTarget()`): a client resolving to a different Redis than the queues would be a much
 * worse bug than any duplication. `modules/documents/queue/redis.config.ts` re-exports the last two.
 */
import type { ConnectionOptions } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';

import { redactUrlCredentials } from '@/utils/redact-url';

type RedisEnv = { url: string } | { host: string; port: string; password?: string };

function readRedisEnv(): RedisEnv {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL };
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: process.env.REDIS_PORT ?? '6379',
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  };
}

function hostOptions(env: Exclude<RedisEnv, { url: string }>) {
  return {
    host: env.host,
    port: parseInt(env.port, 10),
    ...(env.password ? { password: env.password } : {}),
  };
}

export function createLibRedisClient(options: RedisOptions = {}): Redis {
  const env = readRedisEnv();
  if ('url' in env) {
    return new Redis(env.url, options);
  }
  return new Redis({ ...hostOptions(env), ...options });
}

/**
 * BullMQ's connection options. Its `{ url }` shape is a `bullmq` extension that ioredis's own
 * constructor does not understand, hence a separate function from `createLibRedisClient`.
 */
export function redisConnection(): ConnectionOptions {
  const env = readRedisEnv();
  if ('url' in env) {
    return { url: env.url } as ConnectionOptions;
  }
  return hostOptions(env);
}

/**
 * Human-facing description of where this process is trying to reach Redis - used by
 * `redis-required.guard.ts` for its boot-time SUCCESS log line and its "Redis unreachable" failure
 * message, so a crash NAMES a target instead of leaving whoever reads the log to go re-derive it
 * from env vars themselves.
 *
 * NEVER the raw `REDIS_URL`. That variable's documented shape carries the password inline
 * (`redis://:pass@redis:6379`, this file's own header), so returning it verbatim printed the
 * credential of every authenticated Redis - which is the normal case on any managed instance - to
 * stdout on every single boot, and again inside an exception message whenever Redis was slow to come
 * up. Everything that touches a container's stdout then holds it: the log aggregator, `docker logs`,
 * an incident capture, a support archive. `redactUrlCredentials` keeps scheme, user, host, port and
 * database index (all of which is what makes this line worth logging) and replaces only the secret.
 *
 * The `REDIS_HOST`/`REDIS_PORT` branch never had the problem: `REDIS_PASSWORD` is a separate variable
 * and was never part of this string.
 */
export function describeRedisTarget(): string {
  const env = readRedisEnv();
  if ('url' in env) return redactUrlCredentials(env.url);
  return `${env.host}:${env.port}`;
}
