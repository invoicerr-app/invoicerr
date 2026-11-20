import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';

import { logger } from '@/logger/logger.service';

import { createLibRedisClient } from './redis-connection';

/** The enriched-session cache `AuthGuard` reads through; see developer-guide/authentication.md. */
export interface SessionCache {
  read<T extends CacheableSession>(cookie: SessionCookie, load: () => Promise<T | null>): Promise<T | null>;
  invalidateUsers(userIds: readonly string[]): Promise<void>;
  invalidateAll(): Promise<void>;
  close(): Promise<void>;
}

export interface CacheableSession {
  user: { id: string };
  session: { token: string; expiresAt: Date | string };
}

export interface SessionCookie {
  /** The raw `Cookie` request header. */
  header: string | undefined;
  /** The session cookie's name, as better-auth names it. */
  name: string;
}

export interface SessionCacheOptions {
  ttlMs: number;
  maxEntries?: number;
  redis: () => Redis;
  keyPrefix?: string;
  now?: () => number;
  retry?: { firstDelayMs: number; maxDelayMs: number; giveUpAfterMs: number };
}

interface Entry {
  value: CacheableSession;
  userId: string;
  snapshot: Snapshot;
  expiresAt: number;
}

interface Snapshot {
  generation: string;
  sequence: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
// Invalidation stamps outlive any entry they could concern.
const STAMP_MARGIN_MS = 60_000;
const DEFAULT_RETRY = { firstDelayMs: 100, maxDelayMs: 5_000, giveUpAfterMs: 10 * 60_000 };
// Past this many users waiting for a retry, invalidating everyone is cheaper and just as correct.
const MAX_PENDING_USERS = 10_000;

// Losing either key (flush, restart) starts a new generation, which disowns every existing entry.
const ENSURE_GENERATION = `
if not redis.call('GET', KEYS[1]) or not redis.call('GET', KEYS[2]) then
  redis.call('SET', KEYS[1], ARGV[1])
  redis.call('SET', KEYS[2], 0)
end`;

const SNAPSHOT_SCRIPT = `${ENSURE_GENERATION}
return {redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2])}`;

const INVALIDATE_SCRIPT = `${ENSURE_GENERATION}
local sequence = redis.call('INCR', KEYS[2])
for i = 3, #KEYS do redis.call('SET', KEYS[i], sequence, 'PX', ARGV[2]) end
return sequence`;

export function createSessionCache(options: SessionCacheOptions): SessionCache {
  const { ttlMs } = options;
  const enabled = ttlMs > 0;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const retry = options.retry ?? DEFAULT_RETRY;
  const prefix = options.keyPrefix ?? '{session-cache}';
  const now = options.now ?? Date.now;
  const generationKey = `${prefix}:generation`;
  const sequenceKey = `${prefix}:sequence`;
  const userKey = (userId: string) => `${prefix}:user:${userId}`;
  const entries = new Map<string, Entry>();
  let client: Redis | null = null;
  let evictionSafe = false;

  const pending = { users: new Set<string>(), all: false, since: 0, delayMs: 0 };
  let retryTimer: NodeJS.Timeout | null = null;

  function connection(): Redis {
    if (!client) {
      const created = options.redis();
      client = created;
      created.on('ready', () => void checkEvictionPolicy(created));
      if (created.status === 'ready') void checkEvictionPolicy(created);
    }
    return client;
  }

  // A stamp evicted under memory pressure would silently undo an invalidation.
  async function checkEvictionPolicy(connected: Redis): Promise<void> {
    evictionSafe = false;
    try {
      const policy = /^maxmemory_policy:(\S+)/m.exec(await connected.info('memory'))?.[1];
      evictionSafe = policy === 'noeviction';
      if (!evictionSafe) {
        logger.error('Session cache disabled: Redis maxmemory-policy must be noeviction', {
          category: 'auth',
          details: { maxmemoryPolicy: policy ?? 'unknown' },
        });
      }
    } catch (error) {
      logFailure('Session cache disabled: could not read the Redis eviction policy', error);
    }
  }

  function readyConnection(): Redis | null {
    const connected = connection();
    return connected.status === 'ready' && evictionSafe ? connected : null;
  }

  async function takeSnapshot(connected: Redis): Promise<Snapshot> {
    const [generation, sequence] = (await connected.eval(
      SNAPSHOT_SCRIPT,
      2,
      generationKey,
      sequenceKey,
      randomUUID(),
    )) as [string, string];
    return { generation, sequence: Number(sequence) };
  }

  async function isCurrent(entry: Entry, connected: Redis): Promise<boolean> {
    const [generation, stamp] = await connected.mget(generationKey, userKey(entry.userId));
    return generation === entry.snapshot.generation && Number(stamp ?? 0) <= entry.snapshot.sequence;
  }

  function store(key: string, entry: Entry): void {
    entries.delete(key);
    if (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key, entry);
  }

  async function publish(users: readonly string[], all: boolean): Promise<void> {
    const connected = connection();
    if (connected.status !== 'ready') throw new Error(`Redis connection is ${connected.status}`);
    if (all) {
      await connected.set(generationKey, randomUUID());
      return;
    }
    await connected.eval(
      INVALIDATE_SCRIPT,
      2 + users.length,
      generationKey,
      sequenceKey,
      ...users.map(userKey),
      randomUUID(),
      ttlMs + STAMP_MARGIN_MS,
    );
  }

  async function publishOrRetry(users: readonly string[], all: boolean): Promise<void> {
    try {
      await publish(users, all);
    } catch (error) {
      logFailure('Session cache invalidation could not reach Redis, retrying', error);
      queueRetry(users, all);
    }
  }

  function queueRetry(users: readonly string[], all: boolean): void {
    if (!pending.all && pending.users.size === 0) {
      pending.since = now();
      pending.delayMs = retry.firstDelayMs;
    }
    for (const user of users) pending.users.add(user);
    if (all || pending.users.size > MAX_PENDING_USERS) {
      pending.all = true;
      pending.users.clear();
    }
    if (!retryTimer) scheduleRetry();
  }

  function scheduleRetry(): void {
    retryTimer = setTimeout(() => void flushPending(), pending.delayMs);
    retryTimer.unref();
  }

  async function flushPending(): Promise<void> {
    retryTimer = null;
    try {
      await publish([...pending.users], pending.all);
      pending.users.clear();
      pending.all = false;
    } catch (error) {
      if (now() - pending.since >= retry.giveUpAfterMs) {
        logFailure('Session cache invalidation abandoned after retrying', error);
        pending.users.clear();
        pending.all = false;
        return;
      }
      pending.delayMs = Math.min(pending.delayMs * 2, retry.maxDelayMs);
      scheduleRetry();
    }
  }

  return {
    async read(cookie, load) {
      const value = enabled ? singleCookieValue(cookie) : undefined;
      const connected = value === undefined ? null : readyConnection();
      if (value === undefined || !connected) return load();

      let snapshot: Snapshot;
      try {
        const cached = entries.get(value);
        if (cached && cached.expiresAt > now() && (await isCurrent(cached, connected))) {
          return structuredClone(cached.value) as Awaited<ReturnType<typeof load>>;
        }
        entries.delete(value);
        snapshot = await takeSnapshot(connected);
      } catch (error) {
        logFailure('Session cache unavailable, loading the session directly', error);
        return load();
      }

      const session = await load();
      if (session && session.session.token === unsignedToken(value)) {
        store(value, {
          value: structuredClone(session),
          userId: session.user.id,
          snapshot,
          expiresAt: Math.min(now() + ttlMs, new Date(session.session.expiresAt).getTime()),
        });
      }
      return session;
    },

    async invalidateUsers(userIds) {
      if (!enabled) return;
      const unique = [...new Set(userIds)];
      if (unique.length === 0) return;
      for (const [key, entry] of entries) if (unique.includes(entry.userId)) entries.delete(key);
      await publishOrRetry(unique, false);
    },

    async invalidateAll() {
      if (!enabled) return;
      entries.clear();
      await publishOrRetry([], true);
    },

    async close() {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      entries.clear();
      client?.disconnect();
      client = null;
    },
  };
}

function logFailure(message: string, error: unknown): void {
  logger.error(message, {
    category: 'auth',
    details: { message: error instanceof Error ? error.message : String(error) },
  });
}

/** The session cookie's value, or `undefined` unless the header carries it exactly once. */
function singleCookieValue({ header, name }: SessionCookie): string | undefined {
  if (!header) return undefined;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === name)
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && values[0] ? values[0] : undefined;
}

function unsignedToken(cookieValue: string): string | undefined {
  try {
    const decoded = decodeURIComponent(cookieValue);
    const dot = decoded.lastIndexOf('.');
    return dot > 0 ? decoded.slice(0, dot) : undefined;
  } catch {
    return undefined;
  }
}

function readSessionCacheTtlMs(): number {
  const DEFAULT_TTL_MS = 10_000;
  const raw = process.env.SESSION_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TTL_MS;
}

function createSessionCacheRedisClient(): Redis {
  const client = createLibRedisClient({
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 250,
    lazyConnect: true,
  });
  client.on('error', () => undefined);
  client.connect().catch(() => undefined);
  return client;
}

export const sessionCache: SessionCache = createSessionCache({
  ttlMs: readSessionCacheTtlMs(),
  redis: createSessionCacheRedisClient,
});
