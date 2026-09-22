/**
 * `createRedisAuthRateLimitCounterStore`'s real end-to-end proof — a real Redis, not a fake. The unit
 * spec (`auth-rate-limit.spec.ts`) proves the CROSS-INSTANCE SHARING contract with a fake store; this
 * file proves the actual Lua script against the actual server: atomic increment-and-expire-once, and
 * — the property a fake can't meaningfully fake — that a key set with no TTL bug never lingers forever.
 *
 * Gated EXPLICITLY (`AUTH_RATE_LIMIT_REDIS_TESTS=1`, same discipline
 * `modules/documents/queue/__tests__/document-action-queue.redis.spec.ts` already documents for why
 * `REDIS_URL` alone is not enough: a bare local `npx vitest run` loads `.env`, so `REDIS_URL` is
 * always set on a dev machine — this must not silently start hitting a real Redis on every run).
 */
import Redis from 'ioredis';

import { createRedisAuthRateLimitCounterStore } from './auth-rate-limit';

const hasRedis = !!process.env.REDIS_URL && process.env.AUTH_RATE_LIMIT_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

describeWithRedis('createRedisAuthRateLimitCounterStore — real Redis', () => {
  let client: Redis;

  beforeAll(() => {
    client = new Redis(process.env.REDIS_URL!);
  });

  afterAll(async () => {
    client.disconnect();
  });

  function uniqueKey(name: string): string {
    return `auth-rate-limit-redis-spec:${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  it('increments across independent calls and reports the running count', async () => {
    const store = createRedisAuthRateLimitCounterStore(client);
    const key = uniqueKey('increment');

    expect(await store.increment(key, 60_000)).toBe(1);
    expect(await store.increment(key, 60_000)).toBe(2);
    expect(await store.increment(key, 60_000)).toBe(3);

    await client.del(key);
  });

  it('sets a TTL on the very first hit — the key does not linger forever', async () => {
    const store = createRedisAuthRateLimitCounterStore(client);
    const key = uniqueKey('ttl');

    await store.increment(key, 60_000);
    const ttlMs = await client.pttl(key);

    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(60_000);

    await client.del(key);
  });

  it('does NOT push the TTL back out on a later hit within the same window (fixed window, not sliding)', async () => {
    const store = createRedisAuthRateLimitCounterStore(client);
    const key = uniqueKey('fixed-window');

    await store.increment(key, 60_000);
    const firstTtl = await client.pttl(key);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await store.increment(key, 60_000);
    const secondTtl = await client.pttl(key);

    // The second hit must not have RENEWED the expiry — it should be strictly counting down from the
    // first hit's own deadline (allowing for the ~50ms this test itself slept, plus normal jitter).
    expect(secondTtl).toBeLessThan(firstTtl);

    await client.del(key);
  });

  it('expires on its own — a key from an old window disappears with no manual cleanup', async () => {
    const store = createRedisAuthRateLimitCounterStore(client);
    const key = uniqueKey('expiry');

    await store.increment(key, 100); // a 100ms window.
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(await client.exists(key)).toBe(0);
    // A fresh hit after expiry starts a brand new window at 1, never resumes the old count.
    expect(await store.increment(key, 60_000)).toBe(1);

    await client.del(key);
  });

  it('keeps two independently-constructed stores pointed at the same Redis in sync — the actual cross-replica proof', async () => {
    // Two SEPARATE ioredis connections and two separate store instances — standing in for two
    // different API replica processes, each opening its own connection at its own boot
    // (`create-app.ts`'s own call site), never sharing a client object in memory.
    const clientA = new Redis(process.env.REDIS_URL!);
    const clientB = new Redis(process.env.REDIS_URL!);
    const storeA = createRedisAuthRateLimitCounterStore(clientA);
    const storeB = createRedisAuthRateLimitCounterStore(clientB);
    const key = uniqueKey('cross-replica');

    try {
      expect(await storeA.increment(key, 60_000)).toBe(1);
      expect(await storeB.increment(key, 60_000)).toBe(2); // sees replica A's own hit.
      expect(await storeA.increment(key, 60_000)).toBe(3); // sees replica B's own hit back.
    } finally {
      await client.del(key);
      clientA.disconnect();
      clientB.disconnect();
    }
  });
});
