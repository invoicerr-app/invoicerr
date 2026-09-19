import { PrismaPg } from '@prisma/adapter-pg';

import {
  buildDatabasePoolConfig,
  readDatabasePoolConnectTimeoutMs,
  readDatabasePoolMax,
} from './database-pool-config';

describe('readDatabasePoolMax', () => {
  const ORIGINAL = process.env.DATABASE_POOL_MAX;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = ORIGINAL;
  });

  it(
    "defaults to 10 when unset — pg-pool's own implicit default, so a single-container " +
      'self-hosted instance sees no behavior change',
    () => {
      delete process.env.DATABASE_POOL_MAX;
      expect(readDatabasePoolMax()).toBe(10);
    },
  );

  it('reads an override from the environment', () => {
    process.env.DATABASE_POOL_MAX = '5';
    expect(readDatabasePoolMax()).toBe(5);
  });
});

describe('readDatabasePoolConnectTimeoutMs', () => {
  const ORIGINAL = process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS;
    else process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = ORIGINAL;
  });

  it('defaults to 10 seconds when unset', () => {
    delete process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS;
    expect(readDatabasePoolConnectTimeoutMs()).toBe(10_000);
  });

  it('reads an override from the environment', () => {
    process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = '5000';
    expect(readDatabasePoolConnectTimeoutMs()).toBe(5000);
  });

  // The one case this function deliberately does NOT defer to pg-pool's own fallback — see this
  // function's own header: pg-pool leaves `connectionTimeoutMillis` with no default of its own,
  // which is exactly the "waits forever" footgun this file exists to close.
  it(
    'falls back to the 10s default (never to pg-pool\'s own "no timeout") for a non-positive or ' +
      'unparsable value',
    () => {
      process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = '0';
      expect(readDatabasePoolConnectTimeoutMs()).toBe(10_000);

      process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = '-5';
      expect(readDatabasePoolConnectTimeoutMs()).toBe(10_000);

      process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = 'not-a-number';
      expect(readDatabasePoolConnectTimeoutMs()).toBe(10_000);
    },
  );
});

describe('buildDatabasePoolConfig', () => {
  const ORIGINAL_MAX = process.env.DATABASE_POOL_MAX;
  const ORIGINAL_TIMEOUT = process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS;

  afterEach(() => {
    if (ORIGINAL_MAX === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = ORIGINAL_MAX;
    if (ORIGINAL_TIMEOUT === undefined) delete process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS;
    else process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = ORIGINAL_TIMEOUT;
  });

  it('carries the connection string plus both explicit knobs', () => {
    process.env.DATABASE_POOL_MAX = '7';
    process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = '3000';

    expect(buildDatabasePoolConfig('postgresql://user:pass@host:5432/db')).toEqual({
      connectionString: 'postgresql://user:pass@host:5432/db',
      max: 7,
      connectionTimeoutMillis: 3000,
    });
  });

  /**
   * Proves the configured limit actually reaches the driver, not merely that the env var was parsed
   * correctly in isolation above. `@prisma/adapter-pg`'s own `PrismaPgAdapterFactory` constructor
   * (`node_modules/@prisma/adapter-pg/dist/index.js`) stores whatever plain object it is given
   * verbatim as `this.config`, and its `connect()` method later does `new pg.Pool(this.config)` —
   * so asserting on the CONSTRUCTED adapter's own `config` field is asserting on the exact object
   * `pg.Pool` will read `max`/`connectionTimeoutMillis` off, without needing a real socket or a real
   * Postgres to prove the wiring is correct. `prisma.service.ts` passes this exact function's return
   * value to `new PrismaPg(...)`, so this is the real production call shape, not a re-implementation
   * of it.
   */
  it('reaches the actual PrismaPg/pg.Pool config object, not just a parsed env value', () => {
    process.env.DATABASE_POOL_MAX = '4';
    process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = '2500';

    const adapter = new PrismaPg(buildDatabasePoolConfig('postgresql://user:pass@host:5432/db'));

    expect(
      (adapter as unknown as { config: { max: number; connectionTimeoutMillis: number } }).config,
    ).toEqual({
      connectionString: 'postgresql://user:pass@host:5432/db',
      max: 4,
      connectionTimeoutMillis: 2500,
    });
  });
});
