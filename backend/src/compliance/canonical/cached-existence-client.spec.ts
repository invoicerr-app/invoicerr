/**
 * §7 — CachedExistenceClient unit tests.
 *
 * Covers:
 *  - NullIdentifierExistenceClient returns exists: null (offline-safe default)
 *  - Cache hit avoids a second call to the inner client
 *  - Network-error responses are NOT cached (transient failures don't poison the cache)
 *  - evictExpired cleans up stale entries
 */
import { CachedExistenceClient } from './cached-existence-client';
import {
  ExistenceCheckResult,
  IdentifierExistencePort,
  NullIdentifierExistenceClient,
} from './identifier-existence.port';

// ---------------------------------------------------------------------------
// NullIdentifierExistenceClient — offline-safe default
// ---------------------------------------------------------------------------

describe('NullIdentifierExistenceClient (offline-safe default)', () => {
  const client = new NullIdentifierExistenceClient();

  it('checkVat returns exists: null (not blocking)', async () => {
    const result = await client.checkVat('FR40303265045');
    expect(result.exists).toBeNull();
    expect(result.source).toBe('null');
    expect(result.error).toBeUndefined();
  });

  it('checkSiret returns exists: null (not blocking)', async () => {
    const result = await client.checkSiret('73282932000074');
    expect(result.exists).toBeNull();
    expect(result.source).toBe('null');
  });
});

// ---------------------------------------------------------------------------
// CachedExistenceClient — cache semantics
// ---------------------------------------------------------------------------

class SpyClient implements IdentifierExistencePort {
  vatCalls = 0;
  siretCalls = 0;

  constructor(
    private readonly vatResult: ExistenceCheckResult = { scheme: 'VAT', value: 'FR123', exists: true, source: 'vies' },
    private readonly siretResult: ExistenceCheckResult = { scheme: 'SIRET', value: '73282932000074', exists: true, source: 'sirene' },
  ) {}

  async checkVat(vatNumber: string): Promise<ExistenceCheckResult> {
    this.vatCalls++;
    return { ...this.vatResult, value: vatNumber };
  }

  async checkSiret(siret: string): Promise<ExistenceCheckResult> {
    this.siretCalls++;
    return { ...this.siretResult, value: siret };
  }
}

describe('CachedExistenceClient', () => {
  it('uses NullIdentifierExistenceClient by default (offline-safe)', async () => {
    const cached = new CachedExistenceClient(new NullIdentifierExistenceClient());
    const result = await cached.checkVat('FR40303265045');
    expect(result.exists).toBeNull();
    expect(result.source).toBe('null');
  });

  it('cache hit avoids second call to inner client', async () => {
    const spy = new SpyClient();
    const cached = new CachedExistenceClient(spy, 60_000);

    const first = await cached.checkVat('FR40303265045');
    const second = await cached.checkVat('FR40303265045');

    expect(first.exists).toBe(true);
    expect(second.exists).toBe(true);
    expect(spy.vatCalls).toBe(1); // only one network call
    expect(cached.cacheSize).toBe(1);
  });

  it('different identifiers are cached separately', async () => {
    const spy = new SpyClient();
    const cached = new CachedExistenceClient(spy, 60_000);

    await cached.checkVat('FR11111111111');
    await cached.checkVat('DE123456789');

    expect(spy.vatCalls).toBe(2);
    expect(cached.cacheSize).toBe(2);
  });

  it('SIRET cache works independently of VAT cache', async () => {
    const spy = new SpyClient();
    const cached = new CachedExistenceClient(spy, 60_000);

    await cached.checkSiret('73282932000074');
    await cached.checkSiret('73282932000074');

    expect(spy.siretCalls).toBe(1);
    expect(cached.cacheSize).toBe(1);
  });

  it('network error responses are NOT cached', async () => {
    const errorClient: IdentifierExistencePort = {
      async checkVat(v) {
        return { scheme: 'VAT', value: v, exists: null, source: 'vies', error: 'Network timeout' };
      },
      async checkSiret(s) {
        return { scheme: 'SIRET', value: s, exists: null, source: 'sirene', error: 'Network timeout' };
      },
    };
    const spy = jest.spyOn(errorClient, 'checkVat');
    const cached = new CachedExistenceClient(errorClient, 60_000);

    await cached.checkVat('FR40303265045');
    await cached.checkVat('FR40303265045');

    expect(spy).toHaveBeenCalledTimes(2); // not cached because error was set
    expect(cached.cacheSize).toBe(0);
  });

  it('exists: false is cached (registry "not found" is definitive)', async () => {
    const notFoundClient: IdentifierExistencePort = {
      async checkVat(v) {
        return { scheme: 'VAT', value: v, exists: false, source: 'vies' };
      },
      async checkSiret(s) {
        return { scheme: 'SIRET', value: s, exists: false, source: 'sirene' };
      },
    };
    const spy = jest.spyOn(notFoundClient, 'checkVat');
    const cached = new CachedExistenceClient(notFoundClient, 60_000);

    await cached.checkVat('FR00000000000');
    await cached.checkVat('FR00000000000');

    expect(spy).toHaveBeenCalledTimes(1); // cached even when not found
    expect(cached.cacheSize).toBe(1);
  });

  it('expired cache entries are evicted by evictExpired', async () => {
    const spy = new SpyClient();
    const cached = new CachedExistenceClient(spy, 1); // 1 ms TTL

    await cached.checkVat('FR40303265045');
    expect(cached.cacheSize).toBe(1);

    await new Promise((r) => setTimeout(r, 5)); // let TTL expire
    cached.evictExpired();
    expect(cached.cacheSize).toBe(0);
  });

  it('expired entry triggers a fresh network call', async () => {
    const spy = new SpyClient();
    const cached = new CachedExistenceClient(spy, 1); // 1 ms TTL

    await cached.checkVat('FR40303265045');
    await new Promise((r) => setTimeout(r, 5)); // expire
    await cached.checkVat('FR40303265045'); // should re-fetch

    expect(spy.vatCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Executor integration: Null by default → no blocking, no warnings emitted
// ---------------------------------------------------------------------------

import { ComplianceExecutor } from '../execution/executor';
import { NumberingRegistry } from '../lifecycle/numbering';
import { resolve } from '../engine/compliance-engine';
import { TransactionContext } from './canonical-document';
import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile } from './canonical-document';

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Corp`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}40303265045`, validated: true }] : [],
  };
}

function tx(): TransactionContext {
  return {
    supplier: party('FR', 'B2B'),
    buyer: party('DE', 'B2B'),
    lines: [{ id: 'l1', description: 'Test', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' as SupplyType }],
    issueDate: new Date('2026-06-01'),
    currency: 'EUR',
  };
}

describe('Executor §7 — existence wiring', () => {
  it('uses NullIdentifierExistenceClient by default — no existence warnings', async () => {
    const executor = new ComplianceExecutor({ numbering: new NumberingRegistry() });
    const ctx = tx();
    const plan = resolve(ctx);
    const result = await executor.execute(ctx, plan);
    // Null client → exists: null → no warning emitted
    const existenceWarnings = result.warnings.filter((w) => w.includes('[existence]'));
    expect(existenceWarnings).toHaveLength(0);
  });

  it('emits a warning when injected client reports exists: false', async () => {
    const notFoundClient: IdentifierExistencePort = {
      async checkVat(v) {
        return { scheme: 'VAT', value: v, exists: false, source: 'vies' };
      },
      async checkSiret(s) {
        return { scheme: 'SIRET', value: s, exists: false, source: 'sirene' };
      },
    };
    const executor = new ComplianceExecutor({
      numbering: new NumberingRegistry(),
      existence: notFoundClient,
    });
    const ctx = tx();
    const plan = resolve(ctx);
    const result = await executor.execute(ctx, plan);
    const existenceWarnings = result.warnings.filter((w) => w.includes('[existence]'));
    expect(existenceWarnings.length).toBeGreaterThan(0);
    expect(existenceWarnings[0]).toContain('not found in VIES');
  });

  it('existence check never blocks transmission (result still has transmissions)', async () => {
    const alwaysNotFound: IdentifierExistencePort = {
      async checkVat(v) { return { scheme: 'VAT', value: v, exists: false, source: 'vies' }; },
      async checkSiret(s) { return { scheme: 'SIRET', value: s, exists: false, source: 'sirene' }; },
    };
    const executor = new ComplianceExecutor({
      numbering: new NumberingRegistry(),
      existence: alwaysNotFound,
    });
    const ctx = tx();
    const plan = resolve(ctx);
    const result = await executor.execute(ctx, plan);
    // Transmission should still proceed (existence check is advisory only)
    expect(result.transmissions).toBeDefined();
  });
});
