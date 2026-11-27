/**
 * Runs the real `syncDatabaseSchema()` (subprocesses and Prisma client included) against throwaway
 * Postgres databases, one per starting state a production boot can meet:
 *
 *  - an empty volume (fresh install),
 *  - a legacy `db push` instance at v1.4.4a with no migration history,
 *  - a database whose frozen v1.4.4a schema was pushed back over migrations that its history still
 *    records as applied (what the v1.4.5c image's entrypoint did on every restart),
 *  - a second boot on an already migrated database.
 *
 * Every path must end with every migration directory recorded as applied, `InvoiceStatus.DRAFT`
 * present, and the same tables, columns and enum values as the fresh install.
 *
 * Gated like the other throwaway-database specs: `MIGRATION_FRESH_TESTS=1` plus a `DATABASE_URL`
 * whose role can CREATE DATABASE (the queue-integration CI job provides both).
 */
import { vi } from 'vitest';

import 'dotenv/config';

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { Client } from 'pg';

vi.mock('../modules/documents/country-policy/seed', () => ({
  seedCountryPolicies: vi.fn().mockResolvedValue({ upserted: 0, deleted: 0 }),
}));
vi.mock('../modules/documents/country-identifiers/seed', () => ({
  seedCountryIdentifierRequirements: vi.fn().mockResolvedValue({ upserted: 0, deleted: 0 }),
}));

const enabled = process.env.MIGRATION_FRESH_TESTS === '1';
const describeGated = enabled ? describe : describe.skip;

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const BACKEND_ROOT = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'prisma', 'migrations');
const V1_4_4A_SCHEMA_PATH = join(BACKEND_ROOT, 'prisma', 'schema-v1.4.4a.prisma');
const THROWAWAY_PREFIX = 'invoicerr_sync_boot_';

// The migrations directory as shipped in the v1.4.5c image, after the 23 frozen baseline entries.
const V1_4_5C_POST_BASELINE_MIGRATIONS = [
  '20260621230759_add_api_keys',
  '20260622233534_allow_duplicate_client_email',
  '20260623000546_add_articles',
  '20260623015557_add_draft_status',
  '20260624111608_add_archived_invoice_status',
  '20260624120000_rename_receipt_numbering_to_payment',
  '20260624130000_rename_receipt_to_payment',
  '20260624130100_migrate_receipt_mailtemplate_to_payment',
  '20260624205245_add_paid_at_to_payment',
  '20260625143819_add_quote_item_link_to_invoice_item',
  '20260625190000_add_name_to_quote_invoice_items',
];

function migrationDirectories(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
    .sort();
}

function assertThrowawayName(name: string): void {
  if (!name.startsWith(THROWAWAY_PREFIX) || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to operate on database "${name}": not a throwaway name`);
  }
}

function withDatabase(base: URL, database: string): string {
  const url = new URL(base.toString());
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

function prismaCli(databaseUrl: string, args: string[]): void {
  execFileSync('npx', ['prisma', ...args], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: '' },
    stdio: 'inherit',
  });
}

async function query<T extends object>(
  databaseUrl: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** Boots the real sync against `databaseUrl`, with a Prisma client bound to that database. */
async function bootSync(databaseUrl: string): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL_UNPOOLED = '';
  vi.resetModules();
  const { default: prisma } = await import('./prisma.service');
  try {
    const { syncDatabaseSchema } = await import('./sync-schema');
    await syncDatabaseSchema();
  } finally {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previous;
  }
}

interface ShapeSnapshot {
  columns: string[];
  enumValues: string[];
}

async function snapshotShape(databaseUrl: string): Promise<ShapeSnapshot> {
  const columns = await query<{ entry: string }>(
    databaseUrl,
    `SELECT table_name || '.' || column_name AS entry FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`,
  );
  const enumValues = await query<{ entry: string }>(
    databaseUrl,
    `SELECT t.typname || '.' || e.enumlabel AS entry FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' ORDER BY 1`,
  );
  return { columns: columns.map((r) => r.entry), enumValues: enumValues.map((r) => r.entry) };
}

async function expectFullyMigrated(databaseUrl: string): Promise<void> {
  const rows = await query<{ migration_name: string; finished: boolean; rolled_back: boolean }>(
    databaseUrl,
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
     FROM "_prisma_migrations"`,
  );
  const applied = rows.filter((r) => r.finished && !r.rolled_back).map((r) => r.migration_name);
  expect(rows.filter((r) => !r.finished)).toEqual([]);
  expect([...new Set(applied)].sort()).toEqual(migrationDirectories());
  expect(applied).toHaveLength(new Set(applied).size);

  const invoiceStatus = await query<{ value: string }>(
    databaseUrl,
    `SELECT e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'InvoiceStatus'`,
  );
  expect(invoiceStatus.map((r) => r.value)).toContain('DRAFT');
}

/** Writes history rows the way `migrate resolve --applied` does, with the real file checksums. */
async function recordAsApplied(databaseUrl: string, names: string[]): Promise<void> {
  for (const name of names) {
    const script = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'));
    const checksum = createHash('sha256').update(script).digest('hex');
    await query(
      databaseUrl,
      `INSERT INTO "_prisma_migrations"
         (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, $1, $2, now(), now(), 1)`,
      [checksum, name],
    );
  }
}

describeGated('syncDatabaseSchema against a real Postgres', () => {
  let adminClient: Client;
  let baseUrl: URL;
  let freshShape: ShapeSnapshot | undefined;
  const created: string[] = [];

  async function createThrowaway(label: string): Promise<string> {
    const name = `${THROWAWAY_PREFIX}${process.pid}_${label}`;
    assertThrowawayName(name);
    await adminClient.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${name}"`);
    created.push(name);
    return withDatabase(baseUrl, name);
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('MIGRATION_FRESH_TESTS=1 requires DATABASE_URL');
    }
    baseUrl = new URL(process.env.DATABASE_URL);
    adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') });
    await adminClient.connect();
  });

  afterAll(async () => {
    try {
      for (const name of created) {
        assertThrowawayName(name);
        await adminClient.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally {
      await adminClient?.end();
    }
  });

  it('applies every migration on an empty database, so InvoiceStatus has DRAFT', async () => {
    const url = await createThrowaway('fresh');

    await bootSync(url);

    await expectFullyMigrated(url);
    freshShape = await snapshotShape(url);

    // A second boot on the same database changes nothing.
    await bootSync(url);
    await expectFullyMigrated(url);
    expect(await snapshotShape(url)).toEqual(freshShape);
  });

  it('baselines a legacy v1.4.4a database with no history, then runs everything newer', async () => {
    const url = await createThrowaway('legacy');
    prismaCli(url, ['db', 'push', '--accept-data-loss', '--schema', V1_4_4A_SCHEMA_PATH]);

    await bootSync(url);

    await expectFullyMigrated(url);
    expect(freshShape).toBeDefined();
    expect(await snapshotShape(url)).toEqual(freshShape);
  });

  it('re-runs migrations whose records survived a push of the frozen v1.4.4a schema', async () => {
    const url = await createThrowaway('relevelled');
    prismaCli(url, ['db', 'push', '--accept-data-loss', '--schema', V1_4_4A_SCHEMA_PATH]);
    const [firstBaseline, ...otherBaseline] = migrationDirectories().slice(0, 23);
    prismaCli(url, ['migrate', 'resolve', '--applied', firstBaseline]);
    await recordAsApplied(url, [...otherBaseline, ...V1_4_5C_POST_BASELINE_MIGRATIONS]);

    const before = await query<{ value: string }>(
      url,
      `SELECT e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'InvoiceStatus'`,
    );
    expect(before.map((r) => r.value)).not.toContain('DRAFT');

    await bootSync(url);

    await expectFullyMigrated(url);
    expect(freshShape).toBeDefined();
    expect(await snapshotShape(url)).toEqual(freshShape);
  });
});
