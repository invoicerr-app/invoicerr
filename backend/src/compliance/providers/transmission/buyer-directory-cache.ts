/**
 * CachedBuyerDirectory — in-memory TTL cache wrapper around BuyerDirectoryPort.
 *
 * §179: same participant must not trigger a second network call within the TTL window.
 *
 * Features:
 *   - TTL expiry per entry (default 5 min).
 *   - In-flight dedup: concurrent lookups for the same key share one pending Promise
 *     (only one network call is made regardless of concurrency).
 *   - Cache key: `identifier|scheme|environment` — ignores unrelated query fields.
 *   - Thread-safe by construction (Node.js single-threaded event loop).
 *
 * Offline-safe: if the delegate returns null (directory unavailable / unregistered),
 * the null is cached so subsequent calls don't retry within the TTL window.
 *
 * Usage:
 *   const cached = new CachedBuyerDirectory(new AfnorDirectoryLookup(client), 300_000);
 */

import type { BuyerDirectoryPort, BuyerDirectoryQuery, BuyerDirectoryResult } from './buyer-directory-port';

interface CacheEntry {
  result: BuyerDirectoryResult | null;
  expiresAt: number; // Date.now() + ttlMs
}

export class CachedBuyerDirectory implements BuyerDirectoryPort {
  /** Cache: key → { result, expiresAt } */
  private readonly _cache = new Map<string, CacheEntry>();

  /** In-flight dedup: key → pending Promise (not yet settled). */
  private readonly _inflight = new Map<string, Promise<BuyerDirectoryResult | null>>();

  /**
   * @param delegate  Underlying BuyerDirectoryPort to call on cache miss.
   * @param ttlMs     Cache TTL in milliseconds. Defaults to 5 minutes (300_000).
   * @param maxSize   Maximum number of cached entries (LRU eviction via insertion order).
   *                  Defaults to 1000. 0 = unbounded (not recommended).
   */
  constructor(
    private readonly delegate: BuyerDirectoryPort,
    private readonly ttlMs: number = 300_000,
    private readonly maxSize: number = 1000,
  ) {}

  async lookup(query: BuyerDirectoryQuery): Promise<BuyerDirectoryResult | null> {
    const key = this._key(query);

    // 1. Hot cache hit (not expired).
    const cached = this._cache.get(key);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.result;
    }
    // Evict stale entry if present.
    if (cached !== undefined) this._cache.delete(key);

    // 2. In-flight dedup: reuse an existing pending Promise.
    const existing = this._inflight.get(key);
    if (existing) return existing;

    // 3. Cache miss: start a new lookup, register it as in-flight.
    const promise = this.delegate.lookup(query).then(
      (result) => {
        // Store result (including null) in the cache.
        this._evictIfFull();
        this._cache.set(key, { result, expiresAt: Date.now() + this.ttlMs });
        this._inflight.delete(key);
        return result;
      },
      (err) => {
        // On error, don't cache; let next call retry immediately.
        this._inflight.delete(key);
        throw err;
      },
    );

    this._inflight.set(key, promise);
    return promise;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _key(q: BuyerDirectoryQuery): string {
    return `${q.identifier}|${q.scheme ?? ''}|${q.environment ?? 'TEST'}`;
  }

  private _evictIfFull(): void {
    if (this.maxSize > 0 && this._cache.size >= this.maxSize) {
      // LRU approximation via insertion-order iteration: delete the oldest entry.
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) this._cache.delete(firstKey);
    }
  }

  /** Visible for tests: how many entries are currently in the cache. */
  get cacheSize(): number {
    return this._cache.size;
  }

  /** Visible for tests: how many lookups are currently in-flight. */
  get inflightCount(): number {
    return this._inflight.size;
  }

  /** Clear the cache (useful for tests). */
  clearCache(): void {
    this._cache.clear();
  }
}
