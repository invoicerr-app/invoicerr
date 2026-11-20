/**
 * Shared gate and polling helper for the real-Redis queue specs (documents and webhooks).
 *
 * A spec runs only when `REDIS_URL` is set AND `DOCUMENTS_QUEUE_REDIS_TESTS=1`: the flag keeps these
 * specs out of an ordinary `npm test` even on a machine that happens to export a `REDIS_URL` (see the
 * longer note in `document-schedule-queue.redis.spec.ts`). Without both, the suite is skipped.
 */
export const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
export const describeWithRedis: typeof describe.skip = hasRedis ? describe : describe.skip;

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
