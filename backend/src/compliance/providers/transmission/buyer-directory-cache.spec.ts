/**
 * §179 — CachedBuyerDirectory unit tests.
 *
 * Verifies:
 *   - Cache hit avoids a second delegate call within TTL.
 *   - Cache miss after TTL expiry triggers a new delegate call.
 *   - Concurrent lookups for the same key are deduplicated (only one delegate call).
 *   - null results (unregistered participant) are also cached.
 *   - Cache key is distinct per identifier+scheme+environment combination.
 *   - maxSize eviction: oldest entry is dropped when cache is full.
 */

import { CachedBuyerDirectory } from './buyer-directory-cache';
import type { BuyerDirectoryPort, BuyerDirectoryQuery, BuyerDirectoryResult } from './buyer-directory-port';

const RESULT: BuyerDirectoryResult = { endpointId: '315143296_1422', metadata: {} };

function makeDelegate(result: BuyerDirectoryResult | null, delayMs = 0): {
  delegate: BuyerDirectoryPort;
  calls: number[];
} {
  const state = { calls: [] as number[] };
  const delegate: BuyerDirectoryPort = {
    async lookup(_q: BuyerDirectoryQuery) {
      state.calls.push(Date.now());
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return result;
    },
  };
  return { delegate, calls: state.calls };
}

// ---------------------------------------------------------------------------

describe('CachedBuyerDirectory', () => {
  const Q: BuyerDirectoryQuery = { identifier: '315143296', scheme: 'SIREN', environment: 'TEST' };

  it('returns the delegate result on first call', async () => {
    const { delegate } = makeDelegate(RESULT);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    const result = await cache.lookup(Q);
    expect(result).toEqual(RESULT);
  });

  it('cache hit: second call returns same result without invoking delegate again', async () => {
    const { delegate, calls } = makeDelegate(RESULT);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    await cache.lookup(Q);
    await cache.lookup(Q);

    expect(calls.length).toBe(1);
  });

  it('cache miss after TTL expiry triggers a new delegate call', async () => {
    const { delegate, calls } = makeDelegate(RESULT);
    // TTL = 1 ms — will expire almost immediately.
    const cache = new CachedBuyerDirectory(delegate, 1);

    await cache.lookup(Q);
    await new Promise((r) => setTimeout(r, 5)); // wait for TTL to expire
    await cache.lookup(Q);

    expect(calls.length).toBe(2);
  });

  it('concurrent lookups for the same key share one in-flight Promise', async () => {
    const { delegate, calls } = makeDelegate(RESULT, 10 /* 10 ms delay */);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    // Fire three concurrent lookups before the first resolves.
    const [r1, r2, r3] = await Promise.all([
      cache.lookup(Q),
      cache.lookup(Q),
      cache.lookup(Q),
    ]);

    expect(calls.length).toBe(1);   // only ONE delegate call despite 3 concurrent requests
    expect(r1).toEqual(RESULT);
    expect(r2).toEqual(RESULT);
    expect(r3).toEqual(RESULT);
  });

  it('caches null results (unregistered participant)', async () => {
    const { delegate, calls } = makeDelegate(null);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    const r1 = await cache.lookup(Q);
    const r2 = await cache.lookup(Q);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(calls.length).toBe(1); // null is cached too
  });

  it('different identifier → different cache key → separate delegate calls', async () => {
    const { delegate, calls } = makeDelegate(RESULT);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    await cache.lookup({ identifier: '315143296', scheme: 'SIREN', environment: 'TEST' });
    await cache.lookup({ identifier: '123456789', scheme: 'SIREN', environment: 'TEST' });

    expect(calls.length).toBe(2);
    expect(cache.cacheSize).toBe(2);
  });

  it('different environment → different cache key', async () => {
    const { delegate, calls } = makeDelegate(RESULT);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    await cache.lookup({ identifier: '315143296', environment: 'TEST' });
    await cache.lookup({ identifier: '315143296', environment: 'PROD' });

    expect(calls.length).toBe(2);
  });

  it('maxSize eviction: when full, oldest entry is dropped', async () => {
    const { delegate } = makeDelegate(RESULT);
    const cache = new CachedBuyerDirectory(delegate, 60_000, 2 /* maxSize=2 */);

    await cache.lookup({ identifier: 'A', environment: 'TEST' });
    await cache.lookup({ identifier: 'B', environment: 'TEST' });
    expect(cache.cacheSize).toBe(2);

    // This should evict 'A' (oldest).
    await cache.lookup({ identifier: 'C', environment: 'TEST' });
    expect(cache.cacheSize).toBe(2);
  });

  it('clearCache() empties the cache', async () => {
    const { delegate } = makeDelegate(RESULT);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    await cache.lookup(Q);
    expect(cache.cacheSize).toBe(1);

    cache.clearCache();
    expect(cache.cacheSize).toBe(0);
  });

  it('resolved endpoint flows into returned result (endpointId available to caller)', async () => {
    const endpoint = { endpointId: '0009:12345678900011', metadata: { apEndpointUrl: 'https://ap.example.com' } };
    const { delegate } = makeDelegate(endpoint);
    const cache = new CachedBuyerDirectory(delegate, 60_000);

    const result = await cache.lookup({ identifier: '0009:12345678900011', scheme: 'PEPPOL_ID' });
    expect(result?.endpointId).toBe('0009:12345678900011');
    expect(result?.metadata?.apEndpointUrl).toBe('https://ap.example.com');
  });
});
