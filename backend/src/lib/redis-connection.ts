/**
 * ioredis connection factory shared by the `lib/`-level cross-replica state added for the 3-API-
 * replica topology: the Redis-backed rate-limit storage (`app.module.ts`'s `ThrottlerModule.forRoot`
 * and `lib/auth-rate-limit.ts`), the per-company SSO registry's cross-replica sync
 * (`lib/sso-registry.ts`), and the legal-release notification lock (`legal/legal-release-lock.ts`).
 *
 * Deliberately its OWN small helper rather than importing `modules/documents/queue/redis.config.ts` —
 * mirroring `lib/pending-signup-store.ts`'s own choice (see that file's own header): keeping `lib/`
 * decoupled from `modules/documents/` is worth duplicating ~10 lines of connection-precedence logic.
 * Unlike `pending-signup-store.ts`, which duplicates that logic a SECOND time for itself, every ONE of
 * the callers above shares THIS copy — a third, fourth and fifth `lib/`-level file inventing their own
 * would be the drift `pending-signup-store.ts`'s own header already warns a shared copy avoids; two
 * copies (this one, and `pending-signup-store.ts`'s pre-existing one) is the accepted cost of that
 * module boundary, not a reason to keep multiplying it.
 *
 * Same `REDIS_URL`-else-`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` precedence as
 * `modules/documents/queue/redis.config.ts` and `lib/pending-signup-store.ts` — kept in sync
 * deliberately: a `lib/`-level client resolving to a DIFFERENT Redis than the documents module's own
 * queue would be a much worse bug than the duplication itself.
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
