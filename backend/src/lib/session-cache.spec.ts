import { vi } from 'vitest';
import Redis from 'ioredis';

import { logger } from '@/logger/logger.service';
import { redisDescribe } from '@/test/redis-gate';

import { createSessionCache, SessionCache } from './session-cache';

vi.mock('@/logger/logger.service', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/prisma/prisma.service', () => ({ __esModule: true, default: {} }));

const COOKIE_NAME = 'better-auth.session_token';
const describeWithRedis = redisDescribe('SESSION_CACHE_REDIS_TESTS');

interface FakeSession {
  user: { id: string };
  session: { token: string; expiresAt: Date };
  activeCompanyId: string;
}

function cookieFor(token: string) {
  return { header: `theme=dark; ${COOKIE_NAME}=${token}.c2lnbmF0dXJl%3D`, name: COOKIE_NAME };
}

function sessionOf(
  userId: string,
  token: string,
  activeCompanyId: string,
  expiresInMs = 3_600_000,
): FakeSession {
  return {
    user: { id: userId },
    session: { token, expiresAt: new Date(Date.now() + expiresInMs) },
    activeCompanyId,
  };
}

/** A loader standing in for better-auth: answers whatever `state.activeCompanyId` holds now. */
function loaderFor(userId: string, token: string, state: { activeCompanyId: string; expiresInMs?: number }) {
  return vi.fn(async () => sessionOf(userId, token, state.activeCompanyId, state.expiresInMs));
}

describe('createSessionCache without Redis', () => {
  it('loads the session on every request when Redis is unreachable', async () => {
    const cache = createSessionCache({
      ttlMs: 10_000,
      redis: () => new Redis({ port: 1, lazyConnect: true, enableOfflineQueue: false }),
    });
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });

    await cache.read(cookieFor('token-1'), load);
    await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
    await cache.close();
  });

  it('returns from an invalidation at once, without piling up listeners, while Redis is unreachable', async () => {
    const client = new Redis({ port: 1, lazyConnect: true, enableOfflineQueue: false });
    const cache = createSessionCache({ ttlMs: 10_000, redis: () => client });

    const startedAt = Date.now();
    for (let i = 0; i < 20; i++) await cache.invalidateUsers([`user-${i}`]);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(client.listenerCount('ready')).toBeLessThanOrEqual(1);
    await cache.close();
  });

  it('does not touch Redis on an invalidation when the cache is off', async () => {
    const redis = vi.fn(() => new Redis({ port: 1, lazyConnect: true, enableOfflineQueue: false }));
    const cache = createSessionCache({ ttlMs: 0, redis });

    await cache.invalidateUsers(['user-1']);
    await cache.invalidateAll();

    expect(redis).not.toHaveBeenCalled();
    await cache.close();
  });
});

describeWithRedis('createSessionCache with Redis', () => {
  let admin: Redis;
  const caches: SessionCache[] = [];
  let keyPrefix: string;
  let now: number;

  function replica(options: { ttlMs?: number; maxEntries?: number; redis?: () => Redis } = {}): SessionCache {
    const cache = createSessionCache({
      ttlMs: options.ttlMs ?? 10_000,
      maxEntries: options.maxEntries,
      keyPrefix,
      now: () => now,
      redis: options.redis ?? (() => new Redis(process.env.REDIS_URL!)),
      retry: { firstDelayMs: 20, maxDelayMs: 100, giveUpAfterMs: 60_000 },
    });
    caches.push(cache);
    return cache;
  }

  async function connected(cache: SessionCache): Promise<SessionCache> {
    await cache.invalidateUsers(['warm-up']);
    for (let i = 0; i < 50; i++) {
      const load = vi.fn(async () => sessionOf('probe', 'probe', 'x'));
      await cache.read(cookieFor('probe'), load);
      await cache.read(cookieFor('probe'), load);
      if (load.mock.calls.length === 1) return cache;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('session cache never reached Redis');
  }

  beforeAll(() => {
    admin = new Redis(process.env.REDIS_URL!);
  });

  afterAll(async () => {
    admin.disconnect();
  });

  beforeEach(() => {
    keyPrefix = `{session-cache-spec-${Date.now()}-${Math.random().toString(36).slice(2)}}`;
    now = Date.now();
  });

  afterEach(async () => {
    await Promise.all(caches.splice(0).map((cache) => cache.close()));
  });

  it('answers a repeated request from memory', async () => {
    const cache = await connected(replica());
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });

    await cache.read(cookieFor('token-1'), load);
    const second = await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second?.activeCompanyId).toBe('company-a');
  });

  it('loads again once the TTL has passed', async () => {
    const cache = await connected(replica({ ttlMs: 10_000 }));
    const state = { activeCompanyId: 'company-a' };
    const load = loaderFor('user-1', 'token-1', state);

    await cache.read(cookieFor('token-1'), load);
    state.activeCompanyId = 'company-b';
    now += 10_001;
    const after = await cache.read(cookieFor('token-1'), load);

    expect(after?.activeCompanyId).toBe('company-b');
  });

  it('never serves a session past its own expiry', async () => {
    const cache = await connected(replica({ ttlMs: 10_000 }));
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a', expiresInMs: 1_000 });

    await cache.read(cookieFor('token-1'), load);
    now += 5_000;
    await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('sees an invalidation made by another replica on the very next request', async () => {
    const replicaA = await connected(replica());
    const replicaB = await connected(replica());
    const state = { activeCompanyId: 'company-a' };
    const load = loaderFor('user-1', 'token-1', state);
    await replicaA.read(cookieFor('token-1'), load);

    state.activeCompanyId = 'company-b';
    await replicaB.invalidateUsers(['user-1']);
    const after = await replicaA.read(cookieFor('token-1'), load);

    expect(after?.activeCompanyId).toBe('company-b');
  });

  it('retries an invalidation that could not reach Redis, and the other replica follows once it lands', async () => {
    let failNextInvalidation = true;
    const flakyRedis = () => {
      const client = new Redis(process.env.REDIS_URL!);
      const evaluate = client.eval.bind(client) as (...args: unknown[]) => Promise<unknown>;
      client.eval = (async (...args: unknown[]) => {
        if (failNextInvalidation && String(args[0]).includes('INCR')) {
          failNextInvalidation = false;
          throw new Error('connection lost');
        }
        return evaluate(...args);
      }) as Redis['eval'];
      return client;
    };
    const writer = await connected(replica({ redis: flakyRedis }));
    const reader = await connected(replica());
    const state = { activeCompanyId: 'company-a' };
    const load = loaderFor('user-1', 'token-1', state);
    await reader.read(cookieFor('token-1'), load);

    state.activeCompanyId = 'company-b';
    await writer.invalidateUsers(['user-1']);

    await vi.waitFor(async () => {
      expect((await reader.read(cookieFor('token-1'), load))?.activeCompanyId).toBe('company-b');
    });
    expect(failNextInvalidation).toBe(false);
  });

  it('turns itself off when Redis may evict its keys', async () => {
    await admin.config('SET', 'maxmemory-policy', 'allkeys-lru');
    try {
      const cache = replica();
      const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });
      await cache.read(cookieFor('token-1'), load);
      await vi.waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Session cache disabled: Redis maxmemory-policy must be noeviction',
          expect.objectContaining({ details: { maxmemoryPolicy: 'allkeys-lru' } }),
        ),
      );

      await cache.read(cookieFor('token-1'), load);
      await cache.read(cookieFor('token-1'), load);

      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      await admin.config('SET', 'maxmemory-policy', 'noeviction');
    }
  });

  it('keeps serving other users when one user is invalidated', async () => {
    const cache = await connected(replica());
    const load = loaderFor('user-2', 'token-2', { activeCompanyId: 'company-a' });
    await cache.read(cookieFor('token-2'), load);

    await cache.invalidateUsers(['user-1']);
    await cache.read(cookieFor('token-2'), load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('sees an invalidate-everything made by another replica', async () => {
    const replicaA = await connected(replica());
    const replicaB = await connected(replica());
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });
    await replicaA.read(cookieFor('token-1'), load);

    await replicaB.invalidateAll();
    await replicaA.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not keep a session loaded while an invalidation for its user was being recorded', async () => {
    const replicaA = await connected(replica());
    const replicaB = await connected(replica());
    const state = { activeCompanyId: 'company-a' };
    const racingLoad = vi.fn(async () => {
      const stale = sessionOf('user-1', 'token-1', state.activeCompanyId);
      state.activeCompanyId = 'company-b';
      await replicaB.invalidateUsers(['user-1']);
      return stale;
    });
    await replicaA.read(cookieFor('token-1'), racingLoad);

    const after = await replicaA.read(cookieFor('token-1'), loaderFor('user-1', 'token-1', state));

    expect(after?.activeCompanyId).toBe('company-b');
  });

  it('forgets every entry when Redis loses its state', async () => {
    const cache = await connected(replica());
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });
    await cache.read(cookieFor('token-1'), load);

    await admin.del(`${keyPrefix}:generation`, `${keyPrefix}:sequence`);
    await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches nothing when the TTL is zero', async () => {
    const cache = replica({ ttlMs: 0 });
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });

    await cache.read(cookieFor('token-1'), load);
    await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches nothing for a request that carries the session cookie twice', async () => {
    const cache = await connected(replica());
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });
    const twice = {
      header: `${cookieFor('token-1').header}; ${COOKIE_NAME}=token-9.c2ln`,
      name: COOKIE_NAME,
    };

    await cache.read(twice, load);
    await cache.read(twice, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches nothing when the session loaded is not the one the cookie names', async () => {
    const cache = await connected(replica());
    const load = loaderFor('user-1', 'another-token', { activeCompanyId: 'company-a' });

    await cache.read(cookieFor('token-1'), load);
    await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches nothing for a request without a session', async () => {
    const cache = await connected(replica());
    const load = vi.fn(async () => null);

    await cache.read(cookieFor('token-1'), load);
    await cache.read(cookieFor('token-1'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('lets a failing load reach the caller, without loading twice', async () => {
    const cache = await connected(replica());
    const load = vi.fn(async (): Promise<FakeSession | null> => {
      throw new Error('refused');
    });

    await expect(cache.read(cookieFor('token-1'), load)).rejects.toThrow('refused');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('hands every request its own copy of the session', async () => {
    const cache = await connected(replica());
    const load = loaderFor('user-1', 'token-1', { activeCompanyId: 'company-a' });
    const first = await cache.read(cookieFor('token-1'), load);

    first!.activeCompanyId = 'tampered';
    const second = await cache.read(cookieFor('token-1'), load);

    expect(second?.activeCompanyId).toBe('company-a');
  });

  it('holds at most maxEntries sessions', async () => {
    const cache = await connected(replica({ maxEntries: 2 }));
    const loads = ['1', '2', '3'].map((n) => loaderFor(`user-${n}`, `token-${n}`, { activeCompanyId: 'c' }));
    for (const [i, load] of loads.entries()) await cache.read(cookieFor(`token-${i + 1}`), load);

    await cache.read(cookieFor('token-1'), loads[0]);
    await cache.read(cookieFor('token-3'), loads[2]);

    expect(loads[0]).toHaveBeenCalledTimes(2);
    expect(loads[2]).toHaveBeenCalledTimes(1);
  });
});
