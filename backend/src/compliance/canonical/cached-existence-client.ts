/**
 * CachedExistenceClient — in-memory TTL cache wrapping IdentifierExistencePort (§7).
 *
 * Prevents the same VAT/SIRET from being re-checked on every invoice in a session.
 * Only caches successful responses (exists: true | false); network-error results
 * are not cached so a transient VIES outage doesn't permanently suppress checks.
 *
 * Default TTL: 24 h (configurable). The cache is per-process and does not survive
 * restarts — which is intentional (registry data may change between deployments).
 *
 * Usage:
 *   const client = new CachedExistenceClient(new ViesExistenceClient());
 *   // or
 *   const client = new CachedExistenceClient(new NullIdentifierExistenceClient()); // no-op, offline-safe
 */
import { ExistenceCheckResult, IdentifierExistencePort } from './identifier-existence.port';

interface CacheEntry {
  result: ExistenceCheckResult;
  expiresAt: number; // Date.now() ms
}

export class CachedExistenceClient implements IdentifierExistencePort {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * @param inner   The real client to delegate to on cache miss.
   * @param ttlMs   Cache TTL in milliseconds (default 24 h).
   */
  constructor(
    private readonly inner: IdentifierExistencePort,
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
  ) {}

  async checkVat(vatNumber: string): Promise<ExistenceCheckResult> {
    return this.cached(`VAT:${vatNumber}`, () => this.inner.checkVat(vatNumber));
  }

  async checkSiret(siret: string): Promise<ExistenceCheckResult> {
    return this.cached(`SIRET:${siret}`, () => this.inner.checkSiret(siret));
  }

  /** Returns cache size — for observability in tests. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Evict expired entries (call periodically to avoid unbounded growth). */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  private async cached(
    key: string,
    fn: () => Promise<ExistenceCheckResult>,
  ): Promise<ExistenceCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > now) {
      return entry.result;
    }
    const result = await fn();
    // Only cache when the registry gave a definitive answer (no network error).
    if (result.error === undefined) {
      this.cache.set(key, { result, expiresAt: now + this.ttlMs });
    }
    return result;
  }
}
