/**
 * Shared gate and polling helper for every real-Redis spec (`*.redis.spec.ts` and the Redis half of
 * `session-cache.spec.ts`).
 *
 * A gated suite runs only when `REDIS_URL` is set AND its own opt-in flag is `1`: a bare local
 * `npx vitest run` loads `.env`, so `REDIS_URL` alone is set on any dev machine, and the flag keeps
 * these specs out of an ordinary `npm test` (see the longer note in `document-schedule-queue.redis.spec.ts`).
 * Without both, the suite is skipped.
 *
 * Every flag below must be set by a step of the `queue-integration` job in
 * `.github/workflows/cypress.yml`: a flag no workflow sets is a suite that never runs.
 */
export type RedisTestFlag =
  | 'DOCUMENTS_QUEUE_REDIS_TESTS'
  | 'SESSION_CACHE_REDIS_TESTS'
  | 'SSO_REGISTRY_SYNC_REDIS_TESTS'
  | 'AUTH_RATE_LIMIT_REDIS_TESTS'
  | 'LEGAL_RELEASE_LOCK_REDIS_TESTS';

/** `describe` when `REDIS_URL` is set and the suite's flag is `1` (see above), `describe.skip` otherwise. */
export function redisDescribe(flag: RedisTestFlag): typeof describe.skip {
  return !!process.env.REDIS_URL && process.env[flag] === '1' ? describe : describe.skip;
}

/** Polls the REAL table: proof that a background sweep/job genuinely wrote something, not just that a
 *  function call returned. Resolves with the first defined value `check` returns. */
export async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
